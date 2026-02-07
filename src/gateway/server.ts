import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'node:http';
import { readdirSync, statSync, readFileSync, mkdirSync, rmSync, renameSync, watch, type FSWatcher } from 'node:fs';
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
import { setCronRunner } from '../tools/index.js';
import { randomUUID } from 'node:crypto';

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

  // file system watcher manager
  const fileWatchers = new Map<string, { watcher: FSWatcher; refCount: number }>();

  const startWatching = (path: string) => {
    const resolved = resolve(path);
    const existing = fileWatchers.get(resolved);

    if (existing) {
      existing.refCount++;
      return;
    }

    try {
      const watcher = watch(resolved, { recursive: false }, (eventType, filename) => {
        console.log(`[gateway] fs.watch: ${eventType} in ${resolved}${filename ? '/' + filename : ''}`);
        broadcast({
          event: 'fs.change',
          data: { path: resolved, eventType, filename: filename || null, timestamp: Date.now() },
        });
      });

      fileWatchers.set(resolved, { watcher, refCount: 1 });
      console.log(`[gateway] started watching: ${resolved}`);
    } catch (err) {
      console.error(`[gateway] failed to watch ${resolved}:`, err);
    }
  };

  const stopWatching = (path: string) => {
    const resolved = resolve(path);
    const existing = fileWatchers.get(resolved);

    if (!existing) return;

    existing.refCount--;

    if (existing.refCount <= 0) {
      existing.watcher.close();
      fileWatchers.delete(resolved);
      console.log(`[gateway] stopped watching: ${resolved}`);
    }
  };

  const registryPath = join(config.sessionDir, '_registry.json');
  const sessionRegistry = new SessionRegistry(registryPath);
  sessionRegistry.loadFromDisk();
  const fileSessionManager = new SessionManager(config);

  const IDLE_TIMEOUT_MS = 4 * 60 * 60 * 1000; // 4h
  // status messages sent to channels while agent is working
  const statusMessages = new Map<string, { channel: string; chatId: string; messageId: string }>();
  // queued messages for sessions with active runs
  const pendingMessages = new Map<string, InboundMessage[]>();

  // process a channel message (or batched messages) through the agent
  async function processChannelMessage(msg: InboundMessage, batchedBodies?: string[]) {
    const session = sessionRegistry.getOrCreate({
      channel: msg.channel,
      chatType: msg.chatType,
      chatId: msg.chatId,
    });

    // update metadata index
    fileSessionManager.setMetadata(session.sessionId, {
      channel: msg.channel,
      chatId: msg.chatId,
      chatType: msg.chatType,
      senderName: msg.senderName,
    });

    // send status message to channel
    const handler = getChannelHandler(msg.channel);
    let statusMsgId: string | undefined;
    if (handler) {
      try {
        const sent = await handler.send(msg.chatId, 'thinking...');
        statusMsgId = sent.id;
        statusMessages.set(session.key, { channel: msg.channel, chatId: msg.chatId, messageId: sent.id });
      } catch {}
    }

    const body = batchedBodies
      ? `Multiple messages:\n${batchedBodies.map((b, i) => `${i + 1}. ${b}`).join('\n')}`
      : msg.body;

    const channelPrompt = [
      `[Incoming ${msg.channel} message from ${msg.senderName || msg.senderId} in chat ${msg.chatId}]`,
      body,
    ].join('\n');

    const result = await handleAgentRun({
      prompt: channelPrompt,
      sessionKey: session.key,
      source: `${msg.channel}/${msg.chatId}`,
      channel: msg.channel,
    });

    // edit status message with final response
    if (handler && statusMsgId && result?.result && result.result.trim() !== 'SILENT_REPLY') {
      try {
        if (!result.usedMessageTool) {
          await handler.edit(statusMsgId, result.result, msg.chatId);
        } else {
          // agent already sent via message tool, delete the status message
          await handler.delete(statusMsgId, msg.chatId);
        }
      } catch {
        // edit failed (too old?), send new message if agent didn't already
        if (!result.usedMessageTool) {
          try { await handler.send(msg.chatId, result.result); } catch {}
        }
      }
    }
    statusMessages.delete(session.key);

    // process any queued messages
    const queued = pendingMessages.get(session.key);
    if (queued && queued.length > 0) {
      const bodies = queued.map(m => m.body);
      pendingMessages.delete(session.key);
      // use the last message as the "main" message for metadata
      const lastMsg = queued[queued.length - 1];
      await processChannelMessage(lastMsg, bodies);
    }
  }

  // channel manager handles incoming messages from whatsapp/telegram
  const channelManager = new ChannelManager({
    config,
    onMessage: async (msg: InboundMessage) => {
      broadcast({ event: 'channel.message', data: msg });

      if (msg.channel === 'desktop') {
        // desktop handled via chat.send RPC, not here
        return;
      }

      let session = sessionRegistry.getOrCreate({
        channel: msg.channel,
        chatType: msg.chatType,
        chatId: msg.chatId,
      });

      // idle timeout: reset session if too long since last message
      const gap = Date.now() - session.lastMessageAt;
      if (session.messageCount > 0 && gap > IDLE_TIMEOUT_MS) {
        console.log(`[gateway] idle timeout for ${session.key} (${Math.floor(gap / 3600000)}h), starting new session`);
        sessionRegistry.remove(session.key);
        session = sessionRegistry.getOrCreate({
          channel: msg.channel,
          chatType: msg.chatType,
          chatId: msg.chatId,
        });
      }

      sessionRegistry.incrementMessages(session.key);

      // if agent is already running for this chat, queue the message
      if (session.activeRun) {
        const queue = pendingMessages.get(session.key) || [];
        queue.push(msg);
        pendingMessages.set(session.key, queue);

        // notify user
        const handler = getChannelHandler(msg.channel);
        if (handler) {
          try { await handler.send(msg.chatId, 'got it, I\'ll get to this after I\'m done'); } catch {}
        }
        return;
      }

      await processChannelMessage(msg);
    },
    onCommand: async (channel, cmd, chatId) => {
      const chatType = 'dm';
      const key = sessionRegistry.makeKey({ channel, chatType, chatId });

      if (cmd === 'new') {
        const old = sessionRegistry.get(key);
        sessionRegistry.remove(key);
        return `session reset. ${old ? `old: ${old.messageCount} messages.` : ''} new session started.`;
      }

      if (cmd === 'status') {
        const session = sessionRegistry.get(key);
        if (!session) return 'no active session for this chat.';
        const age = Date.now() - session.lastMessageAt;
        const ageMin = Math.floor(age / 60000);
        return [
          `session: ${session.sessionId.slice(0, 30)}`,
          `messages: ${session.messageCount}`,
          `last activity: ${ageMin}m ago`,
          `active: ${session.activeRun ? 'yes' : 'no'}`,
        ].join('\n');
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
    // make cron runner available to MCP tools
    setCronRunner(cronRunner);
  }

  const context: GatewayContext = {
    config,
    sessionRegistry,
    channelManager,
    heartbeatRunner,
    cronRunner,
    broadcast,
  };

  // pending AskUserQuestion requests waiting for desktop answers
  const pendingQuestions = new Map<string, {
    resolve: (answers: Record<string, string>) => void;
    reject: (err: Error) => void;
  }>();

  // canUseTool callback - handles AskUserQuestion by routing to desktop
  const canUseTool = async (toolName: string, input: Record<string, unknown>) => {
    if (toolName === 'AskUserQuestion') {
      const questions = input.questions as unknown[];
      if (!questions) {
        return { behavior: 'allow' as const, updatedInput: input };
      }

      // no clients connected - can't ask
      if (clients.size === 0) {
        return {
          behavior: 'deny' as const,
          message: 'No UI client connected to answer questions. Proceed with your best judgment.',
        };
      }

      const requestId = randomUUID();
      broadcast({
        event: 'agent.ask_user',
        data: { requestId, questions, timestamp: Date.now() },
      });

      // wait for answer from desktop
      const answers = await new Promise<Record<string, string>>((resolve, reject) => {
        pendingQuestions.set(requestId, { resolve, reject });
        // timeout after 5 minutes
        setTimeout(() => {
          if (pendingQuestions.has(requestId)) {
            pendingQuestions.delete(requestId);
            reject(new Error('Question timeout - no answer received'));
          }
        }, 300000);
      });

      return {
        behavior: 'allow' as const,
        updatedInput: { questions, answers },
      };
    }

    // auto-allow other tools
    return { behavior: 'allow' as const, updatedInput: input };
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

    const prev = runQueues.get(sessionKey) || Promise.resolve();
    let result: AgentResult | null = null;

    const run = prev.then(async () => {
      sessionRegistry.setActiveRun(sessionKey, true);
      broadcast({ event: 'status.update', data: { activeRun: true, source, sessionKey } });
      broadcast({ event: 'agent.user_message', data: { source, sessionKey, prompt, timestamp: Date.now() } });
      const runStart = Date.now();

      try {
        const session = sessionRegistry.get(sessionKey);
        const gen = streamAgent({
          prompt,
          sessionId: session?.sessionId,
          resumeId: session?.sdkSessionId,
          config,
          channel,
          extraContext,
          canUseTool,
        });

        let agentText = '';
        let agentSessionId = '';
        let agentUsage = { inputTokens: 0, outputTokens: 0, totalCostUsd: 0 };
        let usedMessageTool = false;

        for await (const msg of gen) {
          const m = msg as Record<string, unknown>;

          if (m.type === 'system' && m.subtype === 'init' && m.session_id) {
            agentSessionId = m.session_id as string;
            sessionRegistry.setSdkSessionId(sessionKey, agentSessionId);
            fileSessionManager.setMetadata(session?.sessionId || '', { sdkSessionId: agentSessionId });
          }

          if (m.type === 'stream_event') {
            const event = m.event as Record<string, unknown>;
            broadcast({
              event: 'agent.stream',
              data: { source, sessionKey, event, timestamp: Date.now() },
            });

            if (event.type === 'content_block_start') {
              const cb = event.content_block as Record<string, unknown>;
              if (cb?.type === 'tool_use') {
                if (cb.name === 'message') usedMessageTool = true;
                broadcast({
                  event: 'agent.tool_use',
                  data: { source, sessionKey, tool: cb.name, timestamp: Date.now() },
                });
                // update status message in channel
                const sm = statusMessages.get(sessionKey);
                if (sm) {
                  const h = getChannelHandler(sm.channel);
                  if (h) { try { await h.edit(sm.messageId, `running ${cb.name as string}...`, sm.chatId); } catch {} }
                }
              }
            }
          }

          if (m.type === 'assistant') {
            broadcast({
              event: 'agent.message',
              data: { source, sessionKey, message: m, timestamp: Date.now() },
            });
            const assistantMsg = m.message as Record<string, unknown>;
            const content = assistantMsg?.content as unknown[];
            if (Array.isArray(content)) {
              for (const block of content) {
                const b = block as Record<string, unknown>;
                if (b.type === 'text') agentText = b.text as string;
              }
            }
          }

          if (m.type === 'user') {
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
                      sessionKey,
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
            sessionKey,
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
          data: { source, sessionKey, error: err instanceof Error ? err.message : String(err), timestamp: Date.now() },
        });
      } finally {
        sessionRegistry.setActiveRun(sessionKey, false);
        broadcast({ event: 'status.update', data: { activeRun: false, source, sessionKey } });
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

          const sessionKey = 'desktop:dm:default';
          const session = sessionRegistry.getOrCreate({
            channel: 'desktop',
            chatId: 'default',
          });
          sessionRegistry.incrementMessages(session.key);
          fileSessionManager.setMetadata(session.sessionId, { channel: 'desktop', chatId: 'default', chatType: 'dm' });

          handleAgentRun({
            prompt,
            sessionKey,
            source: 'desktop/chat',
          });

          return { id, result: { sessionKey, sessionId: session.sessionId, queued: true } };
        }

        case 'chat.answerQuestion': {
          const requestId = params?.requestId as string;
          const answers = params?.answers as Record<string, string>;
          if (!requestId) return { id, error: 'requestId required' };
          if (!answers) return { id, error: 'answers required' };
          const pending = pendingQuestions.get(requestId);
          if (!pending) return { id, error: 'no pending question with that ID' };
          pendingQuestions.delete(requestId);
          pending.resolve(answers);
          return { id, result: { answered: true } };
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

        case 'sessions.reset': {
          const channel = params?.channel as string;
          const chatId = params?.chatId as string;
          if (!channel || !chatId) return { id, error: 'channel and chatId required' };
          const key = sessionRegistry.makeKey({ channel, chatId });
          sessionRegistry.remove(key);
          return { id, result: { reset: true, key } };
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

        case 'fs.read': {
          const filePath = params?.path as string;
          if (!filePath) return { id, error: 'path required' };
          const resolved = resolve(filePath);
          try {
            const content = readFileSync(resolved, 'utf-8');
            return { id, result: { content, path: resolved } };
          } catch (err) {
            return { id, error: err instanceof Error ? err.message : String(err) };
          }
        }

        case 'fs.readBinary': {
          const filePath = params?.path as string;
          if (!filePath) return { id, error: 'path required' };
          const resolved = resolve(filePath);
          try {
            const buffer = readFileSync(resolved);
            const base64 = buffer.toString('base64');
            return { id, result: { content: base64, path: resolved } };
          } catch (err) {
            return { id, error: err instanceof Error ? err.message : String(err) };
          }
        }

        case 'fs.mkdir': {
          const dirPath = params?.path as string;
          if (!dirPath) return { id, error: 'path required' };
          const resolved = resolve(dirPath);
          try {
            mkdirSync(resolved, { recursive: true });
            return { id, result: { created: resolved } };
          } catch (err) {
            return { id, error: err instanceof Error ? err.message : String(err) };
          }
        }

        case 'fs.delete': {
          const targetPath = params?.path as string;
          if (!targetPath) return { id, error: 'path required' };
          const resolved = resolve(targetPath);
          try {
            rmSync(resolved, { recursive: true, force: true });
            return { id, result: { deleted: resolved } };
          } catch (err) {
            return { id, error: err instanceof Error ? err.message : String(err) };
          }
        }

        case 'fs.rename': {
          const oldPath = params?.oldPath as string;
          const newPath = params?.newPath as string;
          if (!oldPath || !newPath) return { id, error: 'oldPath and newPath required' };
          const resolvedOld = resolve(oldPath);
          const resolvedNew = resolve(newPath);
          try {
            renameSync(resolvedOld, resolvedNew);
            return { id, result: { oldPath: resolvedOld, newPath: resolvedNew } };
          } catch (err) {
            return { id, error: err instanceof Error ? err.message : String(err) };
          }
        }

        case 'fs.watch.start': {
          const watchPath = params?.path as string;
          if (!watchPath) return { id, error: 'path required' };
          startWatching(watchPath);
          return { id, result: { watching: resolve(watchPath) } };
        }

        case 'fs.watch.stop': {
          const watchPath = params?.path as string;
          if (!watchPath) return { id, error: 'path required' };
          stopWatching(watchPath);
          return { id, result: { stopped: resolve(watchPath) } };
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

      // close all file watchers
      for (const [path, { watcher }] of fileWatchers) {
        watcher.close();
        console.log(`[gateway] closed watcher: ${path}`);
      }
      fileWatchers.clear();

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
