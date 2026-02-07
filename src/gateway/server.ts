import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'node:http';
import { readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import type { Config } from '../config.js';
import type { WsMessage, WsResponse, WsEvent, GatewayContext } from './types.js';
import { SessionRegistry } from './session-registry.js';
import { ChannelManager } from './channel-manager.js';
import { SessionManager } from '../session/manager.js';
import { streamAgent, type AgentResult } from '../agent.js';
import { startHeartbeatRunner, type HeartbeatRunner } from '../heartbeat/runner.js';
import { startCronRunner, loadCronJobs, saveCronJobs, type CronRunner } from '../cron/scheduler.js';
import { checkSkillEligibility, loadAllSkills } from '../skills/loader.js';
import type { InboundMessage } from '../channels/types.js';
import { getChannelHandler } from '../tools/messaging.js';

const DEFAULT_PORT = 18789;
const DEFAULT_HOST = 'localhost';

export type GatewayOptions = {
  config: Config;
  port?: number;
  host?: string;
};

export type Gateway = {
  close: () => Promise<void>;
  broadcast: (event: WsEvent) => void;
  sessionRegistry: SessionRegistry;
  channelManager: ChannelManager;
  heartbeatRunner: HeartbeatRunner | null;
  cronRunner: CronRunner | null;
  context: GatewayContext;
};

export async function startGateway(opts: GatewayOptions): Promise<Gateway> {
  const { config } = opts;
  const port = opts.port || config.gateway?.port || DEFAULT_PORT;
  const host = opts.host || config.gateway?.host || DEFAULT_HOST;
  const startedAt = Date.now();

  const clients = new Set<WebSocket>();

  const broadcast = (event: WsEvent): void => {
    const data = JSON.stringify(event);
    for (const ws of clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    }
  };

  const sessionRegistry = new SessionRegistry();
  const fileSessionManager = new SessionManager(config);

  // channel manager handles incoming messages from whatsapp/telegram
  const channelManager = new ChannelManager({
    config,
    onMessage: async (msg: InboundMessage) => {
      broadcast({ event: 'channel.message', data: msg });

      // route to agent
      const session = sessionRegistry.getOrCreate({
        channel: msg.channel,
        chatType: msg.chatType,
        chatId: msg.chatId,
      });
      sessionRegistry.incrementMessages(session.key);

      // wrap prompt with channel context
      const channelPrompt = [
        `[Incoming ${msg.channel} message from ${msg.senderName || msg.senderId} in chat ${msg.chatId}]`,
        msg.body,
      ].join('\n');

      // for messaging channels, pass chatId as extra context
      const extraContext = ['whatsapp', 'telegram'].includes(msg.channel)
        ? `Reply using: message({ action: 'send', channel: '${msg.channel}', target: '${msg.chatId}', message: 'your reply' })`
        : undefined;

      const result = await handleAgentRun({
        prompt: channelPrompt,
        sessionKey: session.key,
        source: `${msg.channel}/${msg.chatId}`,
        channel: msg.channel,
        extraContext,
      });

      // messaging channels: agent controls sending via message tool
      // desktop: auto-send for simple chat UX
      if (msg.channel === 'desktop') {
        // desktop: always auto-send (unless SILENT_REPLY)
        if (result?.result && result.result.trim() !== 'SILENT_REPLY') {
          const handler = getChannelHandler(msg.channel);
          if (handler) {
            try {
              await handler.send(msg.chatId, result.result);
              console.log(`[gateway] desktop reply sent: chatId=${msg.chatId}`);
            } catch (err) {
              console.error(`[gateway] desktop reply failed:`, err);
            }
          }
        }
      } else {
        // whatsapp/telegram: agent uses message tool (no auto-send)
        if (result?.result?.trim() === 'SILENT_REPLY') {
          console.log(`[gateway] silent reply: channel=${msg.channel} chatId=${msg.chatId}`);
        } else if (!result?.usedMessageTool && result?.result) {
          console.warn(`[gateway] agent didn't use message tool: channel=${msg.channel} chatId=${msg.chatId} - message not sent`);
        } else if (result?.usedMessageTool) {
          console.log(`[gateway] agent handled send via message tool: channel=${msg.channel} chatId=${msg.chatId}`);
        }
      }
    },
    onStatus: (status) => {
      broadcast({ event: 'channel.status', data: status });
    },
  });

  // heartbeat
  let heartbeatRunner: HeartbeatRunner | null = null;
  let lastHeartbeatStatus: string | null = null;

  if (config.heartbeat?.enabled) {
    heartbeatRunner = startHeartbeatRunner({
      config,
      onMessage: (text) => {
        broadcast({ event: 'heartbeat.result', data: { text, timestamp: Date.now() } });
      },
      onEvent: (event) => {
        lastHeartbeatStatus = event.status;
        broadcast({ event: 'heartbeat.run', data: { ...event, timestamp: Date.now() } });
      },
    });
  }

  // cron
  let cronRunner: CronRunner | null = null;
  if (config.cron?.enabled !== false) {
    cronRunner = startCronRunner({
      config,
      onJobRun: (job, result) => {
        broadcast({ event: 'cron.result', data: { job: job.id, name: job.name, ...result, timestamp: Date.now() } });
      },
    });
  }

  const context: GatewayContext = {
    config,
    sessionRegistry,
    channelManager,
    heartbeatRunner,
    cronRunner,
    broadcast,
  };

  // agent run queue (one per session key)
  const runQueues = new Map<string, Promise<void>>();

  async function handleAgentRun(params: {
    prompt: string;
    sessionKey: string;
    source: string;
    channel?: string;
    extraContext?: string;
  }): Promise<AgentResult | null> {
    const { prompt, sessionKey, source, channel, extraContext } = params;
    console.log(`[gateway] agent run: source=${source} sessionKey=${sessionKey} prompt="${prompt.slice(0, 80)}..."`);

    // queue runs per session
    const prev = runQueues.get(sessionKey) || Promise.resolve();
    let result: AgentResult | null = null;

    const run = prev.then(async () => {
      sessionRegistry.setActiveRun(sessionKey, true);
      broadcast({ event: 'status.update', data: { activeRun: true, source } });
      broadcast({ event: 'agent.user_message', data: { source, prompt, timestamp: Date.now() } });
      const runStart = Date.now();

      try {
        // look up real SDK session ID for resume (undefined on first run)
        const sdkResumeId = sessionRegistry.get(sessionKey)?.sdkSessionId;

        const gen = streamAgent({
          prompt,
          sessionId: sdkResumeId,
          config,
          channel,
          extraContext,
        });

        // track result from stream (for-await-of doesn't capture generator return value)
        let agentText = '';
        let agentSessionId = '';
        let agentUsage = { inputTokens: 0, outputTokens: 0, totalCostUsd: 0 };
        let usedMessageTool = false;

        for await (const msg of gen) {
          const m = msg as Record<string, unknown>;

          // capture real SDK session ID from init message
          if (m.type === 'system' && m.subtype === 'init' && m.session_id) {
            agentSessionId = m.session_id as string;
            sessionRegistry.setSdkSessionId(sessionKey, agentSessionId);
          }

          // broadcast stream events to ws clients
          if (m.type === 'stream_event') {
            const event = m.event as Record<string, unknown>;
            broadcast({
              event: 'agent.stream',
              data: { source, event, timestamp: Date.now() },
            });

            // detect tool use
            if (event.type === 'content_block_start') {
              const cb = event.content_block as Record<string, unknown>;
              if (cb?.type === 'tool_use') {
                // track if message tool was used
                if (cb.name === 'message') {
                  usedMessageTool = true;
                }
                broadcast({
                  event: 'agent.tool_use',
                  data: { source, tool: cb.name, timestamp: Date.now() },
                });
              }
            }
          }

          if (m.type === 'assistant') {
            broadcast({
              event: 'agent.message',
              data: { source, message: m, timestamp: Date.now() },
            });
            // extract text from assistant message
            const assistantMsg = m.message as Record<string, unknown>;
            const content = assistantMsg?.content as unknown[];
            if (Array.isArray(content)) {
              for (const block of content) {
                const b = block as Record<string, unknown>;
                if (b.type === 'text') agentText = b.text as string;
              }
            }
          }

          // tool results come as synthetic user messages
          if (m.type === 'user' && (m as any).isSynthetic) {
            const userMsg = (m as any).message;
            const content = userMsg?.content;
            if (Array.isArray(content)) {
              for (const block of content) {
                if (block.type === 'tool_result') {
                  let resultText = '';
                  if (typeof block.content === 'string') {
                    resultText = block.content;
                  } else if (Array.isArray(block.content)) {
                    resultText = block.content
                      .filter((c: any) => c.type === 'text')
                      .map((c: any) => c.text)
                      .join('\n');
                  }
                  broadcast({
                    event: 'agent.tool_result',
                    data: {
                      source,
                      tool_use_id: block.tool_use_id,
                      content: resultText.slice(0, 2000),
                      is_error: block.is_error || false,
                      timestamp: Date.now(),
                    },
                  });
                }
              }
            }
          }

          if (m.type === 'result') {
            agentText = (m.result as string) || agentText;
            agentSessionId = (m.session_id as string) || agentSessionId;
            const u = m.usage as Record<string, number>;
            agentUsage = {
              inputTokens: u?.input_tokens || 0,
              outputTokens: u?.output_tokens || 0,
              totalCostUsd: (m.total_cost_usd as number) || 0,
            };
          }
        }

        result = {
          sessionId: agentSessionId || '',
          result: agentText,
          messages: [],
          usage: agentUsage,
          durationMs: Date.now() - runStart,
          usedMessageTool,
        };
        console.log(`[gateway] agent done: source=${source} result="${agentText.slice(0, 100)}..." cost=$${agentUsage.totalCostUsd?.toFixed(4) || '?'}`);

        broadcast({
          event: 'agent.result',
          data: {
            source,
            sessionId: result.sessionId,
            result: result.result,
            usage: result.usage,
            timestamp: Date.now(),
          },
        });
      } catch (err) {
        console.error(`[gateway] agent error: source=${source}`, err);
        broadcast({
          event: 'agent.error',
          data: { source, error: err instanceof Error ? err.message : String(err), timestamp: Date.now() },
        });
      } finally {
        sessionRegistry.setActiveRun(sessionKey, false);
        broadcast({ event: 'status.update', data: { activeRun: false, source } });
      }
    });

    runQueues.set(sessionKey, run.catch(() => {}));
    await run;
    return result;
  }

  // rpc handler
  async function handleRpc(msg: WsMessage): Promise<WsResponse> {
    const { method, params, id } = msg;

    try {
      switch (method) {
        case 'status': {
          return {
            id,
            result: {
              running: true,
              startedAt,
              channels: channelManager.getStatuses(),
              sessions: sessionRegistry.list(),
              heartbeat: heartbeatRunner ? {
                enabled: config.heartbeat?.enabled ?? false,
                interval: config.heartbeat?.every || '30m',
                lastRunAt: null,
                nextDueAt: null,
                lastStatus: lastHeartbeatStatus,
              } : null,
              cron: cronRunner ? {
                enabled: true,
                jobCount: cronRunner.listJobs().length,
              } : null,
            },
          };
        }

        case 'chat.send': {
          const prompt = params?.prompt as string;
          if (!prompt) return { id, error: 'prompt required' };

          const sessionId = params?.sessionId as string | undefined;
          const sessionKey = `desktop:dm:${sessionId || 'default'}`;

          const session = sessionRegistry.getOrCreate({
            channel: 'desktop',
            chatId: sessionId || 'default',
          });
          sessionRegistry.incrementMessages(session.key);

          // run async, respond immediately
          handleAgentRun({
            prompt,
            sessionKey,
            source: 'desktop/chat',
          });

          return { id, result: { sessionKey, sessionId: session.sessionId, queued: true } };
        }

        case 'chat.history': {
          const sessionId = params?.sessionId as string;
          if (!sessionId) return { id, error: 'sessionId required' };
          const messages = fileSessionManager.load(sessionId);
          return { id, result: messages };
        }

        case 'sessions.list': {
          const fileSessions = fileSessionManager.list();
          return { id, result: fileSessions };
        }

        case 'sessions.get': {
          const sessionId = params?.sessionId as string;
          if (!sessionId) return { id, error: 'sessionId required' };
          const messages = fileSessionManager.load(sessionId);
          return { id, result: { sessionId, messages } };
        }

        case 'sessions.delete': {
          const sessionId = params?.sessionId as string;
          if (!sessionId) return { id, error: 'sessionId required' };
          const deleted = fileSessionManager.delete(sessionId);
          return { id, result: { deleted } };
        }

        case 'channels.status': {
          return { id, result: channelManager.getStatuses() };
        }

        case 'channels.start': {
          const channelId = params?.channel as string;
          if (!channelId) return { id, error: 'channel required' };
          await channelManager.startChannel(channelId);
          return { id, result: { started: channelId } };
        }

        case 'channels.stop': {
          const channelId = params?.channel as string;
          if (!channelId) return { id, error: 'channel required' };
          await channelManager.stopChannel(channelId);
          return { id, result: { stopped: channelId } };
        }

        case 'cron.list': {
          const jobs = cronRunner?.listJobs() || loadCronJobs();
          return { id, result: jobs };
        }

        case 'cron.add': {
          if (!cronRunner) return { id, error: 'cron not enabled' };
          const job = cronRunner.addJob(params as any);
          return { id, result: job };
        }

        case 'cron.remove': {
          if (!cronRunner) return { id, error: 'cron not enabled' };
          const jobId = params?.id as string;
          if (!jobId) return { id, error: 'id required' };
          const removed = cronRunner.removeJob(jobId);
          return { id, result: { removed } };
        }

        case 'cron.toggle': {
          const jobId = params?.id as string;
          if (!jobId) return { id, error: 'id required' };
          const jobs = loadCronJobs();
          const job = jobs.find(j => j.id === jobId);
          if (!job) return { id, error: 'job not found' };
          job.enabled = !job.enabled;
          saveCronJobs(jobs);
          return { id, result: { id: jobId, enabled: job.enabled } };
        }

        case 'cron.run': {
          if (!cronRunner) return { id, error: 'cron not enabled' };
          const jobId = params?.id as string;
          if (!jobId) return { id, error: 'id required' };
          const runResult = await cronRunner.runJobNow(jobId);
          return { id, result: runResult };
        }

        case 'heartbeat.status': {
          return {
            id,
            result: {
              enabled: config.heartbeat?.enabled ?? false,
              interval: config.heartbeat?.every || '30m',
              lastStatus: lastHeartbeatStatus,
            },
          };
        }

        case 'heartbeat.run': {
          if (!heartbeatRunner) return { id, error: 'heartbeat not enabled' };
          const hbResult = await heartbeatRunner.runNow('manual');
          return { id, result: hbResult };
        }

        case 'skills.list': {
          const allSkills = loadAllSkills(config);
          const result = allSkills.map(skill => ({
            name: skill.name,
            description: skill.description,
            path: skill.path,
            userInvocable: skill.userInvocable,
            metadata: skill.metadata,
            eligibility: checkSkillEligibility(skill, config),
          }));
          return { id, result };
        }

        case 'config.get': {
          return { id, result: config };
        }

        case 'config.set': {
          // hot reload not implemented yet - just acknowledge
          return { id, error: 'config.set not yet implemented' };
        }

        case 'fs.list': {
          const dirPath = params?.path as string;
          if (!dirPath) return { id, error: 'path required' };
          const resolved = resolve(dirPath);
          try {
            const entries = readdirSync(resolved, { withFileTypes: true });
            const items = entries.map(e => ({
              name: e.name,
              type: (e.isDirectory() ? 'directory' : 'file') as 'directory' | 'file',
              size: e.isFile() ? (() => { try { return statSync(join(resolved, e.name)).size; } catch { return 0; } })() : undefined,
            }));
            items.sort((a, b) => {
              if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
              return a.name.localeCompare(b.name);
            });
            return { id, result: items };
          } catch (err) {
            return { id, error: err instanceof Error ? err.message : String(err) };
          }
        }

        default:
          return { id, error: `unknown method: ${method}` };
      }
    } catch (err) {
      return { id, error: err instanceof Error ? err.message : String(err) };
    }
  }

  // start http + ws server
  const httpServer = createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', uptime: Date.now() - startedAt }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  const wss = new WebSocketServer({ server: httpServer });

  wss.on('connection', (ws) => {
    clients.add(ws);
    console.log(`[gateway] client connected (${clients.size} total)`);

    // send initial status
    ws.send(JSON.stringify({
      event: 'status.update',
      data: {
        running: true,
        startedAt,
        channels: channelManager.getStatuses(),
        sessions: sessionRegistry.list(),
      },
    }));

    ws.on('message', async (raw) => {
      let msg: WsMessage;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        ws.send(JSON.stringify({ error: 'invalid json' }));
        return;
      }

      if (!msg.method) {
        ws.send(JSON.stringify({ error: 'method required' }));
        return;
      }

      const response = await handleRpc(msg);
      ws.send(JSON.stringify(response));
    });

    ws.on('close', () => {
      clients.delete(ws);
      console.log(`[gateway] client disconnected (${clients.size} total)`);
    });

    ws.on('error', (err) => {
      console.error('[gateway] ws error:', err.message);
      clients.delete(ws);
    });
  });

  await new Promise<void>((resolve) => {
    httpServer.listen(port, host, () => {
      console.log(`[gateway] listening on ws://${host}:${port}`);
      resolve();
    });
  });

  // start channels
  await channelManager.startAll();

  return {
    close: async () => {
      heartbeatRunner?.stop();
      cronRunner?.stop();
      await channelManager.stopAll();

      for (const ws of clients) {
        ws.close();
      }
      clients.clear();

      await new Promise<void>((resolve) => {
        wss.close(() => {
          httpServer.close(() => resolve());
        });
      });
    },
    broadcast,
    sessionRegistry,
    channelManager,
    heartbeatRunner,
    cronRunner,
    context,
  };
}
