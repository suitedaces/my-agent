# dorabot

Your personal AI agent that lives on WhatsApp, Telegram, and a desktop app. It can browse the web, send messages, manage files, run code, and handle scheduled tasks — all with persistent memory across conversations.

<img width="4336" height="2644" alt="image" src="https://github.com/user-attachments/assets/8ebfb9cf-0e41-45b9-9fed-26b5a9d14d5c" />


## What Can It Do?

- **Chat anywhere** — Talk to the same agent on WhatsApp, Telegram, or the desktop app. It remembers everything across channels.
- **Browse the web** — Opens pages, fills forms, clicks buttons, takes screenshots. Logs into sites once with a persistent browser profile.
- **Schedule tasks** — Set reminders, recurring jobs, or full cron schedules. "Remind me to check email every morning at 9am."
- **Read and send email** — Manages your inbox via [himalaya](https://github.com/pimalaya/himalaya).
- **Work with GitHub** — Create PRs, review issues, check CI — anything the `gh` CLI can do.
- **Run code and manage files** — Full access to your terminal, file system, and dev tools.
- **Learn about you** — Workspace files let you define its personality, teach it about yourself, and store persistent facts.
- **Extend with skills** — Drop a markdown file in a folder and the agent picks up new capabilities automatically.


https://github.com/user-attachments/assets/d675347a-46c0-4767-b35a-e7a1db6386f9



## Quick Start

### Prerequisites

- Node.js 22+
- An Anthropic API key (`ANTHROPIC_API_KEY`) or a [Claude Pro/Max subscription](https://claude.ai) logged in via the `claude` CLI
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
# interactive mode
dorabot -i

# one-off question
dorabot -m "what's the weather in SF?"

# start the gateway (needed for desktop app and channels)
dorabot -g
```

## Desktop App

A native control center for your agent with real-time streaming, session history, channel management, and a file explorer.

```bash
cd desktop
npm install
npm run electron:dev    # requires gateway running
```

## Channels

### WhatsApp

```bash
dorabot --whatsapp-login    # scan the QR code
```

Once linked, messages you receive on WhatsApp are forwarded to the agent. It replies using the same thread.

### Telegram

1. Create a bot with [@BotFather](https://t.me/BotFather)
2. Set the token:
   ```bash
   export TELEGRAM_BOT_TOKEN=your_token
   ```
3. Start the channel from the desktop app or via gateway RPC.

## Making It Yours

### Workspace

Edit these files in `~/.dorabot/workspace/` to shape the agent:

| File | What it does |
|------|-------------|
| `SOUL.md` | Personality, tone, how it should behave |
| `USER.md` | Who you are, what you do, your preferences |
| `MEMORY.md` | Facts the agent should always remember |
| `AGENTS.md` | Extra instructions for the agent |

### Skills

Skills are markdown files that give the agent specialized knowledge. Built-in skills include GitHub, email, macOS commands, and meme generation.

Add your own by dropping a `SKILL.md` in `~/.dorabot/skills/your-skill/`. The agent auto-discovers them and matches them to your prompts.

### Config

Config lives at `~/.dorabot/config.json` (or `./dorabot.config.json` locally).

```json
{
  "model": "claude-sonnet-4-5-20250929",
  "channels": {
    "whatsapp": { "enabled": false },
    "telegram": { "enabled": false, "token": "" }
  }
}
```

## Security

- The agent can only access paths you allow (default: `~/`, `/tmp`)
- Sensitive dirs are always blocked: `~/.ssh`, `~/.gnupg`, `~/.aws`
- Gateway requires token auth for all connections
- Tool approvals: auto-allow safe tools, require confirmation for sensitive ones

## Tech Stack

Node.js, TypeScript, Electron, React, Playwright, Baileys, grammy

## License

MIT
