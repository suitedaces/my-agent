#!/usr/bin/env node

import 'dotenv/config';
import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline';
import { loadConfig } from './config.js';
import { migrateDataDir } from './migrate.js';
import { runAgent, streamAgent } from './agent.js';
import { SessionManager } from './session/manager.js';
import { getEligibleSkills } from './skills/loader.js';
import { listAgentNames, describeAgents } from './agents/definitions.js';
import { startScheduler, loadCalendarItems, migrateCronToCalendar } from './calendar/scheduler.js';
import { startGateway } from './gateway/index.js';
import { getAllChannelStatuses } from './channels/index.js';
import { loginWhatsApp, logoutWhatsApp, isWhatsAppLinked } from './channels/whatsapp/index.js';

async function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('readable', () => {
      let chunk;
      while ((chunk = process.stdin.read()) !== null) {
        data += chunk;
      }
    });
    process.stdin.on('end', () => {
      resolve(data.trim());
    });

    // if nothing comes in 100ms, assume interactive
    setTimeout(() => {
      if (!data) {
        process.stdin.destroy();
        resolve('');
      }
    }, 100);
  });
}

async function interactiveMode(config: Awaited<ReturnType<typeof loadConfig>>): Promise<void> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const sessionManager = new SessionManager(config);
  let currentSessionId: string | undefined;

  console.log('dorabot interactive mode');
  console.log('Commands: /new, /resume <id>, /sessions, /skills, /agents, /schedule, /channels, /exit\n');

  const promptUser = (): void => {
    rl.question('> ', async (input) => {
      const trimmed = input.trim();

      if (!trimmed) {
        promptUser();
        return;
      }

      // handle commands
      if (trimmed.startsWith('/')) {
        const [cmd, ...args] = trimmed.slice(1).split(/\s+/);

        switch (cmd) {
          case 'new':
            currentSessionId = undefined;
            console.log('Started new session');
            break;

          case 'resume':
            const id = args[0];
            if (id && sessionManager.exists(id)) {
              currentSessionId = id;
              console.log(`Resumed session: ${id}`);
            } else {
              console.log('Session not found. Use /sessions to list.');
            }
            break;

          case 'sessions':
            const sessions = sessionManager.list();
            if (sessions.length === 0) {
              console.log('No sessions found.');
            } else {
              console.log('Sessions:');
              for (const s of sessions.slice(0, 10)) {
                console.log(`  ${s.id} (${s.messageCount} messages, ${s.updatedAt})`);
              }
            }
            break;

          case 'skills':
            const skills = getEligibleSkills(config);
            console.log(`Eligible skills (${skills.length}):`);
            for (const skill of skills) {
              console.log(`  ${skill.name}: ${skill.description}`);
            }
            break;

          case 'agents':
            console.log('Available agents:');
            console.log(describeAgents(config));
            break;

          case 'schedule':
          case 'cron':
            if (args[0] === 'list') {
              const items = loadCalendarItems();
              if (items.length === 0) {
                console.log('No scheduled items.');
              } else {
                console.log('Scheduled items:');
                for (const item of items) {
                  const sched = item.rrule ? `RRULE: ${item.rrule}` : `at ${item.dtstart}`;
                  console.log(`  ${item.id}: ${item.summary} (${sched})`);
                }
              }
            } else {
              console.log('Usage: /schedule list');
            }
            break;

          case 'channels': {
            const statuses = getAllChannelStatuses();
            if (statuses.length === 0) {
              console.log('No channels registered. Start gateway mode with --gateway');
            } else {
              console.log('Channels:');
              for (const s of statuses) {
                const status = s.connected ? 'connected' : s.running ? 'running' : 'stopped';
                console.log(`  ${s.channel} (${s.accountId}): ${status}${s.lastError ? ` - ${s.lastError}` : ''}`);
              }
            }
            break;
          }

          case 'exit':
          case 'quit':
            rl.close();
            process.exit(0);

          default:
            console.log(`Unknown command: /${cmd}`);
        }

        promptUser();
        return;
      }

      // run agent
      try {
        console.log('');
        const gen = streamAgent({
          prompt: trimmed,
          sessionId: currentSessionId,
          config,
        });

        let sdkSessionId = '';
        let totalCostUsd = 0;
        for await (const msg of gen) {
          const m = msg as Record<string, unknown>;

          if (m.type === 'stream_event') {
            const event = m.event as Record<string, unknown>;
            if (event.type === 'content_block_delta') {
              const delta = event.delta as Record<string, unknown>;
              if (delta.type === 'text_delta') {
                process.stdout.write(delta.text as string);
              }
            }
          }

          if (m.type === 'system' && m.subtype === 'init' && m.session_id) {
            sdkSessionId = m.session_id as string;
          }
          if (m.type === 'result') {
            sdkSessionId = (m.session_id as string) || sdkSessionId;
            totalCostUsd = (m.total_cost_usd as number) || 0;
          }
        }

        if (sdkSessionId) {
          currentSessionId = currentSessionId || sdkSessionId;
          console.log(`\n\n[Session: ${currentSessionId}] [Cost: $${totalCostUsd.toFixed(4)}]\n`);
        }
      } catch (err) {
        console.error('Error:', err);
      }

      promptUser();
    });
  };

  promptUser();
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    options: {
      message: { type: 'string', short: 'm' },
      resume: { type: 'string', short: 'r' },
      config: { type: 'string', short: 'c' },
      stream: { type: 'boolean', short: 's', default: true },
      interactive: { type: 'boolean', short: 'i' },
      daemon: { type: 'boolean', short: 'd' },
      gateway: { type: 'boolean', short: 'g' },
      model: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
      // whatsapp commands
      'whatsapp-login': { type: 'boolean' },
      'whatsapp-logout': { type: 'boolean' },
      'whatsapp-status': { type: 'boolean' },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(`
dorabot - Claude Agent SDK powered assistant

Usage:
  dorabot [options] [message]
  dorabot -i                    # interactive mode
  dorabot -d                    # daemon mode (scheduler)
  dorabot -g                    # gateway mode (channels + scheduler)
  dorabot -m "Hello"            # single message
  echo "Hello" | dorabot        # pipe input

Options:
  -m, --message <text>    Message to send
  -r, --resume <id>       Resume session by ID
  -c, --config <path>     Config file path
  -s, --stream            Stream output (default: true)
  -i, --interactive       Interactive mode
  -d, --daemon            Daemon mode (run scheduler)
  -g, --gateway           Gateway mode (channels + scheduler)
  --model <name>          Override model
  -h, --help              Show help
  -v, --version           Show version

WhatsApp Commands:
  --whatsapp-login        Link WhatsApp account via QR code
  --whatsapp-logout       Unlink WhatsApp account
  --whatsapp-status       Check WhatsApp connection status

Commands (interactive mode):
  /new                    Start new session
  /resume <id>            Resume session
  /sessions               List sessions
  /skills                 List available skills
  /agents                 List available agents
  /schedule list          List scheduled items
  /channels               List channel statuses
  /exit                   Exit
`);
    process.exit(0);
  }

  if (values.version) {
    console.log('dorabot 1.0.0');
    process.exit(0);
  }

  migrateDataDir();
  const config = await loadConfig(values.config);

  // override model if specified
  if (values.model) {
    config.model = values.model;
  }

  // whatsapp commands
  if (values['whatsapp-login']) {
    const result = await loginWhatsApp(config.channels?.whatsapp?.authDir);
    process.exit(result.success ? 0 : 1);
  }

  if (values['whatsapp-logout']) {
    await logoutWhatsApp(config.channels?.whatsapp?.authDir);
    process.exit(0);
  }

  if (values['whatsapp-status']) {
    const linked = isWhatsAppLinked(config.channels?.whatsapp?.authDir);
    console.log(`WhatsApp: ${linked ? 'linked' : 'not linked'}`);
    process.exit(0);
  }

  // gateway mode - run channels + scheduler (all managed by gateway)
  if (values.gateway) {
    console.log('Starting gateway mode...');

    const gateway = await startGateway({ config });

    console.log('Gateway running. Press Ctrl+C to stop.');

    process.on('SIGINT', async () => {
      console.log('\nStopping gateway...');
      await gateway.close();
      process.exit(0);
    });

    await new Promise(() => {});
    return;
  }

  // daemon mode - run scheduler in background
  if (values.daemon) {
    console.log('Starting daemon mode...');

    migrateCronToCalendar();
    const scheduler = startScheduler({
      config,
      onItemRun: (item, result) => console.log(`[calendar] ${item.summary}: ${result.status}`),
    });

    console.log('Daemon running. Press Ctrl+C to stop.');

    process.on('SIGINT', () => {
      console.log('\nStopping daemon...');
      scheduler.stop();
      process.exit(0);
    });

    await new Promise(() => {});
    return;
  }

  // interactive mode
  if (values.interactive) {
    await interactiveMode(config);
    return;
  }

  // get prompt from args, flag, or stdin
  let prompt = values.message || positionals.join(' ');
  if (!prompt) {
    prompt = await readStdin();
  }

  if (!prompt) {
    // no input, start interactive mode
    await interactiveMode(config);
    return;
  }

  // single run
  if (values.stream) {
    const gen = streamAgent({
      prompt,
      sessionId: values.resume,
      config,
    });

    let sdkSessionId = '';
    let totalCostUsd = 0;
    for await (const msg of gen) {
      const m = msg as Record<string, unknown>;

      if (m.type === 'stream_event') {
        const event = m.event as Record<string, unknown>;
        if (event.type === 'content_block_delta') {
          const delta = event.delta as Record<string, unknown>;
          if (delta.type === 'text_delta') {
            process.stdout.write(delta.text as string);
          }
        }
      }

      if (m.type === 'system' && m.subtype === 'init' && m.session_id) {
        sdkSessionId = m.session_id as string;
      }
      if (m.type === 'result') {
        sdkSessionId = (m.session_id as string) || sdkSessionId;
        totalCostUsd = (m.total_cost_usd as number) || 0;
      }
    }

    if (sdkSessionId) {
      console.log(`\n\n[Session: ${sdkSessionId}] [Cost: $${totalCostUsd.toFixed(4)}]`);
    }
  } else {
    const result = await runAgent({
      prompt,
      sessionId: values.resume,
      config,
    });

    console.log(result.result);
    console.log(`\n[Session: ${result.sessionId}] [Duration: ${result.durationMs}ms] [Cost: $${result.usage.totalCostUsd.toFixed(4)}]`);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
