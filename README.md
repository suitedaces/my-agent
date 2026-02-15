<div align="center">
  <img src="desktop/public/dorabot.png" width="120" />

  # dorabot

  **Open-source personal AI agent.**

  Your personal AI agent with persistent memory, multi-channel messaging (WhatsApp, Telegram, Slack), browser automation, email, Mac control, and a proactive goal system that proposes and ships work without being asked. Runs locally, bring your own model.

</div>

<img width="4336" height="2644" alt="Desktop app" src="https://github.com/user-attachments/assets/8ebfb9cf-0e41-45b9-9fed-26b5a9d14d5c" />

> **Goals board** — The desktop app's Kanban view where the agent proposes goals autonomously and you drag them through Proposed → Approved → In Progress → Done. The right panel shows the project file tree and each card is tagged with priority, owner, and the feature branch it shipped on.

<img alt="Goals Kanban board" src="public/desktop-goals.jpeg" width="800" />

> **Telegram channel** — A real conversation on Telegram where dorabot reports back after completing three feature branches (Slack integration, MiniMax provider, Skills gallery). It summarizes what shipped, what needs attention, and follows up by pushing branches when asked — all without leaving the chat.

<img alt="Telegram chat" src="public/image.png" width="400" />

## What It Does

- **Chat anywhere** - WhatsApp, Telegram, or the desktop app. Persistent memory across all channels.
- **Proactive goal management** - The agent proposes goals on its own, you approve via drag-and-drop Kanban board. It tracks progress, reports results, and picks up new work autonomously.
- **Browse the web** - Fill forms, click buttons, read pages, stay logged in across sessions.
- **Read and send email** - via Himalaya CLI (IMAP/SMTP, no OAuth needed).
- **Control your Mac** - Windows, apps, Spotify, Calendar, Finder, system settings via AppleScript.
- **Schedule anything** - One-shot reminders, recurring tasks, full cron expressions with timezone support.
- **Work with GitHub** - PRs, issues, CI checks, code review via `gh` CLI.
- **Generate images** - Text-to-image and image editing via Gemini API.
- **Extend with skills** - 9 built-in skills, 56k+ community skills from the [skills.sh](https://skills.sh) gallery, or ask the agent to create new ones on the fly.

https://github.com/user-attachments/assets/d675347a-46c0-4767-b35a-e7a1db6386f9

## Quick Start

### Prerequisites

- Node.js 22+
- **Claude** (API key or Pro/Max subscription) or **OpenAI** (API key or ChatGPT login)
- Chrome, Brave, or Edge (for browser features)

### Install

```bash
git clone https://github.com/suitedaces/dorabot.git
cd dorabot
npm install
npm run build
npm link
```

### Run

```bash
# development - gateway + desktop with HMR
npm run dev

# production
dorabot -g            # gateway mode - powers desktop app and channels
dorabot -i            # interactive terminal
dorabot -m "what's the weather in SF?"   # one-off question
```

## Desktop App

An Electron app that connects to the gateway over WebSocket.

- **Chat** - Full chat interface with tool streaming UI, model selection, and effort levels
- **Goals** - Drag-and-drop Kanban board (Proposed, Approved, In Progress, Done)
- **Channels** - Set up WhatsApp (QR code) and Telegram (bot token)
- **Skills** - Browse built-in and community skills, create and edit your own
- **Soul** - Edit personality (SOUL.md), profile (USER.md), and memory (MEMORY.md)
- **Automations** - Manage cron jobs, reminders, and recurring tasks
- **Settings** - Provider setup, approval modes, sandbox config, tool policies

## Multi-Provider Support

Pick the model you're already paying for.

| Provider | Auth | SDK |
|----------|------|-----|
| **Claude** (default) | API key or Pro/Max subscription | [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) |
| **OpenAI Codex** | API key or ChatGPT OAuth | [Codex SDK](https://www.npmjs.com/package/@openai/codex-sdk) |
| **MiniMax** | API key | OpenAI-compatible REST API |

Switch providers from the desktop Settings page or via gateway RPC.

## Channels

### WhatsApp

```bash
dorabot --whatsapp-login    # scan the QR code
```

### Telegram

1. Create a bot with [@BotFather](https://t.me/BotFather)
2. Set `TELEGRAM_BOT_TOKEN=your_token` in your environment (or save to `~/.dorabot/telegram/token`)
3. Start from the desktop app or config

Supports text, photos, videos, audio, documents, voice messages, and inline approval buttons.

### Slack

1. Create a Slack app with Socket Mode enabled
2. Add bot token scopes: `chat:write`, `im:history`, `im:read`, `im:write`, `files:read`, `files:write`, `users:read`
3. Add `connections:write` to the App-Level Token
4. Paste both tokens via the desktop app or `channels.slack.link` RPC

DM-based, same as Telegram. The bot listens for direct messages and responds in-thread.

## Skills

Built-in skills:

| Skill | What it does |
|-------|-------------|
| **github** | Issues, PRs, CI runs via `gh` CLI |
| **himalaya** | Email via IMAP/SMTP CLI |
| **macos** | Window management, apps, Spotify, Calendar, Finder |
| **image-gen** | Gemini API image generation and editing |
| **meme** | Meme generation via memegen.link |
| **onboard** | Interactive setup for USER.md and SOUL.md |
| **polymarket** | Polymarket data and predictions |
| **remotion** | Video creation in React |
| **agent-swarm-orchestration** | Multi-agent task orchestration |

**Add skills** three ways:
- **Manual** - Drop a `SKILL.md` in `~/.dorabot/skills/your-skill/`
- **Gallery** - Browse and install from 56k+ community skills on [skills.sh](https://skills.sh) via the desktop app
- **Agent-created** - Ask "make me a skill for deploying to Vercel" and the agent writes it and makes it available immediately

## Make It Yours

Ask dorabot to onboard you, or edit the files directly:

| File | Purpose |
|------|---------|
| `SOUL.md` | Personality and tone |
| `USER.md` | Who you are, your preferences |
| `MEMORY.md` | Persistent facts across sessions |
| `AGENTS.md` | Extra instructions |

## Architecture

```
┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐
│ Desktop  │  │ Telegram │  │ WhatsApp │  │  Slack   │
│(Electron)│  │ (grammy) │  │(Baileys) │  │ (Bolt)   │
└────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘
     │             │             │             │
     └─────────┬───┴─────────────┴─────┬───────┘
               │                       │
      ┌────────▼────────┐              │
      │  Gateway Server  │  WebSocket RPC (port 18789)
      │  (server.ts)     │  Token-authenticated
      └────────┬────────┘
               │
      ┌────────▼────────┐
      │  Provider Layer  │  Claude / Codex / MiniMax
      │  (providers/)    │  Singleton + lazy init
      └────────┬────────┘
               │
  ┌────────────┼────────────┐
  │            │            │
┌─▼─────┐ ┌───▼─────┐ ┌───▼───┐
│ Tools │ │Sessions │ │ Cron  │
│ (MCP) │ │(SQLite) │ │ Sched │
└───────┘ └─────────┘ └───────┘
```

- **Gateway** - Central hub. ~70 RPC methods for config, sessions, channels, cron, skills, goals, provider management, and tool approval.
- **Providers** - Abstract interface. Claude uses Agent SDK (subprocess), Codex uses Codex SDK. Both support session resumption.
- **Sessions** - SQLite-backed. Persistent across restarts. 4-hour idle timeout for new conversations.
- **Tools** - Built-in via `claude_code` preset (Read, Write, Bash, etc.) plus custom MCP tools (messaging, browser, screenshot, goals, cron).
- **Browser** - Playwright-based. 90+ actions. Persistent profile with authenticated sessions.

## Config

`~/.dorabot/config.json`:

```json
{
  "model": "claude-sonnet-4-5-20250929",
  "provider": {
    "name": "claude"
  },
  "channels": {
    "whatsapp": { "enabled": false },
    "telegram": { "enabled": false, "token": "" }
  },
}
```

## Security

- Scoped file access (default: `~/`, `/tmp`)
- Sensitive dirs always blocked: `~/.ssh`, `~/.gnupg`, `~/.aws`
- Token-authenticated gateway (256-bit hex)
- Configurable tool approval tiers (auto-allow, notify, require-approval)
- Channel-level security policies

## License

MIT
