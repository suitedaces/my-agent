# dorabot

Personal AI agent with multi-channel messaging, browser automation, and persistent memory. Built on the [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk).

Talk to your agent on WhatsApp, Telegram, or a native desktop app. It can browse the web, run code, manage files, send messages across channels, and run scheduled tasks — all with a single persistent identity.

## Features

- **Multi-channel messaging** — WhatsApp (Baileys), Telegram (grammy), desktop app. Same agent, same memory, any channel.
- **Browser automation** — Playwright-core via CDP with a persistent Chrome profile. Log into sites once, agent remembers.
- **Skills system** — Markdown-based skills loaded at runtime. Built-in skills for GitHub, email, macOS, memes, and more. Drop a `SKILL.md` in `~/.dorabot/skills/` to add your own.
- **Workspace context** — SOUL.md (persona), USER.md (your profile), MEMORY.md (persistent facts). The agent reads these every session.
- **Scheduling** — Cron jobs, one-time reminders, recurring tasks. Heartbeat system for periodic check-ins.
- **Desktop control center** — Electron + React app with real-time streaming, tool execution UI, session management, and a file explorer.
- **Gateway RPC** — WebSocket server with 43+ methods. Build your own clients or integrations.
- **Session persistence** — JSONL-based append-only sessions with SDK resume support.

## Quick Start

### Prerequisites

- Node.js 22+
- An Anthropic API key (`ANTHROPIC_API_KEY`)
- Chrome, Brave, or Edge (for browser automation)

### Install

```bash
git clone https://github.com/user/dorabot.git
cd dorabot
npm install
npm run build
npm link  # makes `dorabot` available globally
```

### Run

```bash
# interactive REPL
dorabot -i

# single message
dorabot -m "what's the weather in SF?"

# gateway mode (starts WebSocket server on port 18789)
dorabot -g

# desktop app (requires gateway running)
cd desktop && npm install && npm run electron:dev
```

### Connect Channels

```bash
# WhatsApp — scan QR code
dorabot --whatsapp-login

# Telegram — set bot token
export TELEGRAM_BOT_TOKEN=your_token
```

Once the gateway is running, channels can also be started/stopped from the desktop app or via RPC.

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                     Desktop App                       │
│              (Electron + React + Vite)                │
└─────────────────────┬────────────────────────────────┘
                      │ WebSocket
┌─────────────────────▼────────────────────────────────┐
│                   Gateway Server                      │
│            (WebSocket RPC, port 18789)                │
│                                                       │
│  ┌─────────┐  ┌──────────┐  ┌──────────┐            │
│  │ WhatsApp │  │ Telegram │  │  Desktop │  Channels  │
│  │ (Baileys)│  │ (grammy) │  │  (RPC)   │            │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘            │
│       └──────────────┼─────────────┘                  │
│                      ▼                                │
│  ┌───────────────────────────────────────┐            │
│  │             Agent Core                 │            │
│  │  Claude SDK · System Prompt · Skills   │            │
│  └───────────────────┬───────────────────┘            │
│                      │                                │
│  ┌──────────┬────────┼────────┬──────────┐            │
│  │ Message  │ Browser│ Cron   │Screenshot│  MCP Tools │
│  └──────────┘────────┘────────┘──────────┘            │
│                                                       │
│  ┌───────────────────────────────────────┐            │
│  │          Session Manager               │            │
│  │       (JSONL, ~/.dorabot/sessions/)    │            │
│  └───────────────────────────────────────┘            │
└───────────────────────────────────────────────────────┘
```

### How a Message Flows

1. Message arrives from any channel (WhatsApp, Telegram, desktop, CLI)
2. Gateway wraps it and queues it for the session (one agent run at a time per session)
3. Agent loads config, eligible skills, workspace files (SOUL/USER/MEMORY)
4. System prompt is built dynamically (17 sections, context-aware)
5. Claude SDK `query()` runs with MCP tools, streaming results
6. Responses stream back to the desktop app in real-time
7. For WhatsApp/Telegram, the agent uses the `message` tool to reply
8. Session is persisted to JSONL for future resume

## Project Structure

```
src/
├── index.ts              # CLI entry point
├── agent.ts              # runAgent() and streamAgent() — core orchestration
├── system-prompt.ts      # dynamic 17-section system prompt builder
├── config.ts             # config loading, path allowlisting
├── workspace.ts          # SOUL.md, USER.md, AGENTS.md, MEMORY.md loader
├── gateway/
│   ├── server.ts         # WebSocket RPC server (43+ methods)
│   ├── session-registry.ts  # per-channel session tracking
│   └── channel-manager.ts   # start/stop channel monitors
├── channels/
│   ├── types.ts          # InboundMessage, ChannelHandler interfaces
│   ├── whatsapp/         # Baileys integration (QR login, send/edit/delete)
│   └── telegram/         # grammy integration (long-polling, HTML formatting)
├── tools/
│   ├── index.ts          # MCP server with all custom tools
│   ├── messaging.ts      # send/edit/delete across channels
│   ├── browser.ts        # 20 browser actions (open, click, type, fill, etc.)
│   ├── screenshot.ts     # capture browser screenshots
│   └── cron.ts           # schedule reminders, recurring tasks, cron jobs
├── browser/
│   ├── manager.ts        # Chrome lifecycle, CDP connection, persistent profile
│   ├── refs.ts           # DOM snapshot → e1, e2 refs → Playwright locators
│   └── actions.ts        # all browser actions
├── session/
│   └── manager.ts        # JSONL append-only session storage
├── skills/
│   └── loader.ts         # load skills, eligibility checks, prompt matching
├── cron/
│   └── scheduler.ts      # timer-based cron runner
└── heartbeat/
    └── runner.ts         # periodic check-in system

skills/                   # built-in skills
├── github/               # gh CLI for PRs, issues, CI
├── himalaya/             # email client
├── macos/                # macOS-specific commands
├── meme/                 # meme generation
├── agent-swarm-orchestation/  # multi-agent spawning
└── onboard/              # onboarding workflow

desktop/                  # Electron + React app
├── src/
│   ├── App.tsx           # root layout, tab navigation, resizable panels
│   ├── hooks/useGateway.ts  # WebSocket RPC, state management, 39 methods
│   └── views/            # Chat, Channels, Automations, Memory, Settings
└── electron/
    ├── main.ts           # Electron main process, tray, window
    └── preload.ts        # context bridge
```

## Tools

The agent has access to Claude Code's built-in tools (Read, Write, Edit, Bash, Glob, Grep, WebFetch, WebSearch) plus custom MCP tools:

| Tool | Description |
|------|-------------|
| `message` | Send, edit, delete messages on WhatsApp, Telegram, or desktop |
| `browser` | 20 actions: open URLs, snapshot DOM, click, type, fill forms, screenshot, evaluate JS, save PDFs |
| `screenshot` | Capture browser screenshots |
| `schedule_reminder` | One-time delayed reminder |
| `schedule_recurring` | Repeating task (e.g., every 4 hours) |
| `schedule_cron` | Standard 5-field cron expression |
| `list_reminders` | List all scheduled jobs |
| `cancel_reminder` | Remove a scheduled job |

### Browser Workflow

The browser tool uses a ref-based interaction model:

1. `open` a URL
2. `snapshot` the page — gets interactive elements labeled `e1`, `e2`, `e3`...
3. `click(e1)` or `type(e2, "hello")` — interact by ref
4. Re-`snapshot` after navigation (refs invalidate on page changes)

The browser uses a persistent Chrome profile at `~/.dorabot/browser/profile/`, so authenticated sessions survive across runs.

## Skills

Skills are markdown files with YAML frontmatter that give the agent specialized instructions for specific tasks.

```markdown
---
name: github
description: Interact with GitHub using the gh CLI
metadata:
  requires:
    bins: ['gh']
user-invocable: true
---

# Instructions for using the gh CLI
...
```

**Built-in skills**: github, himalaya (email), macos, meme, agent-swarm-orchestation, onboard

**Add your own**: Drop a `SKILL.md` in `~/.dorabot/skills/your-skill/`. The agent auto-discovers and matches skills to prompts by name and description keywords.

## Workspace

The agent loads context files from `~/.dorabot/workspace/` every session:

| File | Purpose |
|------|---------|
| `SOUL.md` | Persona, tone, behavior guidelines |
| `USER.md` | Your profile, goals, preferences |
| `AGENTS.md` | Agent-specific instructions |
| `MEMORY.md` | Persistent facts the agent should remember |

Edit these to shape how the agent behaves and what it knows about you.

## Gateway RPC

The gateway exposes a WebSocket server for programmatic access. Connect on `ws://localhost:18789`, authenticate with the token from `~/.dorabot/gateway-token`.

```
→ { "method": "auth", "params": { "token": "..." }, "id": "1" }
← { "result": { "ok": true }, "id": "1" }

→ { "method": "chat.send", "params": { "prompt": "hello" }, "id": "2" }
← { "event": "agent.stream", "data": { ... } }  // streamed chunks
← { "result": { "sessionId": "...", "text": "..." }, "id": "2" }
```

**Key methods**: `chat.send`, `chat.history`, `sessions.list`, `channels.status`, `channels.start`, `channels.stop`, `cron.list`, `cron.add`, `heartbeat.run`, `fs.list`, `fs.read`, `config.get`, `config.set`, `skills.list`

## Configuration

Config is loaded from (first found): `./dorabot.config.json` → `~/.dorabot/config.json` → defaults.

```json
{
  "model": "claude-sonnet-4-5-20250929",
  "systemPromptMode": "full",
  "permissionMode": "default",
  "sandbox": { "enabled": false },
  "skills": { "dirs": ["./skills/", "~/.dorabot/skills/"] },
  "sessions": { "dir": "~/.dorabot/sessions/" },
  "channels": {
    "whatsapp": { "enabled": false },
    "telegram": { "enabled": false, "token": "" }
  }
}
```

### Security

- **Path allowlisting**: agent can only access paths in the allowed list (default: `~/`, `/tmp`)
- **Always denied**: `~/.ssh`, `~/.gnupg`, `~/.aws`, `~/.dorabot/whatsapp/auth`, `~/.dorabot/gateway-token`
- **Tool approval**: 3 tiers — auto-allow, notify, require-approval (with 5-minute timeout)
- **Gateway auth**: 64-char hex token, required for all RPC calls

## Build

```bash
# backend
npx tsc                    # → dist/

# desktop frontend
cd desktop && npx vite build    # → desktop/dist/

# desktop electron
cd desktop && npx tsc -p tsconfig.electron.json  # → desktop/dist-electron/

# package desktop app
cd desktop && npm run electron:build
```

## Tech Stack

**Backend**: Node.js 22+, TypeScript 5.6, ESM

**Agent**: Claude Agent SDK, MCP (Model Context Protocol)

**Channels**: Baileys (WhatsApp), grammy (Telegram), WebSocket (desktop)

**Browser**: Playwright-core via CDP

**Desktop**: Electron 33, React 19, Vite 6, Tailwind CSS, Radix UI

**Storage**: JSONL sessions, JSON config, markdown workspace files

## License

MIT
