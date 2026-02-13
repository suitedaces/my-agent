<div align="center">
  <img src="desktop/public/dorabot.png" width="120" />

  # dorabot

  **Turn Claude Code and Codex into your personal AI agent.**

  You already pay for these models. dorabot gives them arms and legs - messaging, browser automation, email, Mac control, scheduling, persistent memory - so they can do real work outside the IDE.

</div>

<img width="4336" height="2644" alt="image" src="https://github.com/user-attachments/assets/8ebfb9cf-0e41-45b9-9fed-26b5a9d14d5c" />

## What It Does

- **Chat anywhere** - WhatsApp, Telegram, or the desktop app. Persistent memory across all channels.
- **Browse the web** - Fill forms, click buttons, read pages, stay logged in across sessions.
- **Read and send email** - via Himalaya CLI (IMAP/SMTP, no OAuth needed).
- **Control your Mac** - Windows, apps, Spotify, Calendar, Finder, system settings via AppleScript.
- **Schedule anything** - One-shot reminders, recurring tasks, full cron expressions with timezone support.
- **Manage goals** - Kanban board with drag-and-drop. Agent proposes tasks, you approve them.
- **Work with GitHub** - PRs, issues, CI checks, code review via `gh` CLI.
- **Generate images** - Text-to-image and image editing via Gemini API.
- **Extend with skills** - Drop a `SKILL.md` in a folder. Built-in skills for GitHub, email, macOS, memes, image gen, Polymarket, video creation, and multi-agent orchestration.

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

# or run individually
npm run dev:gateway   # gateway with auto-reload
npm run dev:desktop   # electron-vite with HMR

# production
dorabot -g            # gateway mode - powers desktop app and channels
dorabot -i            # interactive terminal
dorabot -m "what's the weather in SF?"   # one-off question
```

## Desktop App

An Electron app that connects to the gateway over WebSocket. Includes:

- **Chat** - Full chat interface with tool streaming UI, model selection, and effort levels
- **Goals** - Drag-and-drop Kanban board (Proposed → Approved → In Progress → Done)
- **Channels** - Set up WhatsApp (QR code) and Telegram (bot token) from the UI
- **Skills** - Browse, create, and edit skills with eligibility checks
- **Soul** - Edit your personality (SOUL.md), profile (USER.md), and memory (MEMORY.md)
- **Automations** - Manage cron jobs, reminders, and recurring tasks
- **Settings** - Provider setup, approval modes, sandbox config, tool policies

```bash
cd desktop
npm install
npm run dev
```

## Multi-Provider Support

dorabot supports multiple AI providers. Pick the one you're already paying for.

| Provider | Auth | SDK |
|----------|------|-----|
| **Claude** (default) | API key or Pro/Max subscription OAuth | [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) |
| **OpenAI Codex** | API key or ChatGPT OAuth | [Codex SDK](https://www.npmjs.com/package/@openai/codex-sdk) |

Switch providers from the desktop Settings page or via gateway RPC (`provider.set`).

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

### Desktop App

The desktop app connects to the gateway automatically. See [Desktop App](#desktop-app) above.

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

Add your own: drop a folder with a `SKILL.md` in `~/.dorabot/skills/your-skill/`.

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
┌─────────────┐   ┌─────────────┐   ┌─────────────┐
│  Desktop App │   │  Telegram   │   │  WhatsApp   │
│  (Electron)  │   │  (grammy)   │   │  (Baileys)  │
└──────┬───────┘   └──────┬──────┘   └──────┬──────┘
       │                  │                  │
       └──────────┬───────┴──────────────────┘
                  │
         ┌────────▼────────┐
         │  Gateway Server  │  WebSocket RPC (port 18789)
         │  (server.ts)     │  Token-authenticated
         └────────┬────────┘
                  │
         ┌────────▼────────┐
         │  Provider Layer  │  Claude / Codex
         │  (providers/)    │  Singleton + lazy init
         └────────┬────────┘
                  │
    ┌─────────────┼─────────────┐
    │             │             │
┌───▼───┐  ┌─────▼─────┐  ┌───▼───┐
│ Tools │  │  Sessions  │  │  Cron │
│ (MCP) │  │  (SQLite)  │  │ Sched │
└───────┘  └───────────┘  └───────┘
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
  }
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
