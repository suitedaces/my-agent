<div align="center">
  <img src="desktop/public/dorabot.png" width="120" />

  # dorabot

  **Turn Claude Code and Codex into your own OpenClaw.**

  You already pay for these models. dorabot connects them to WhatsApp, Telegram, your browser, email, and your Mac — so they can work outside the IDE.

</div>

<img width="4336" height="2644" alt="image" src="https://github.com/user-attachments/assets/8ebfb9cf-0e41-45b9-9fed-26b5a9d14d5c" />

## What It Does

- Chat on WhatsApp, Telegram, or the desktop app — persistent memory across channels
- Browse the web: fill forms, click buttons, read pages, stay logged in
- Read and send email
- Schedule reminders, recurring tasks, and cron jobs
- Create PRs, review issues, check CI via GitHub
- Control your Mac: windows, apps, Spotify, Calendar, system settings
- Generate and edit images via Gemini
- Extend with custom skills (drop a markdown file in a folder)

https://github.com/user-attachments/assets/d675347a-46c0-4767-b35a-e7a1db6386f9

## Quick Start

### Prerequisites

- Node.js 22+
- A **Claude** account (API key or Pro/Max subscription) or **OpenAI** account (API key or ChatGPT login) — dorabot talks to Claude via the [Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) and to OpenAI via the [Codex SDK](https://www.npmjs.com/package/@openai/codex-sdk)
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
# gateway mode — powers desktop app and channels
dorabot -g

# interactive terminal
dorabot -i

# one-off question
dorabot -m "what's the weather in SF?"
```

## Channels

### WhatsApp

```bash
dorabot --whatsapp-login    # scan the QR code
```

### Telegram

1. Create a bot with [@BotFather](https://t.me/BotFather)
2. Set `TELEGRAM_BOT_TOKEN=your_token` in your environment
3. Start from the desktop app or config

### Desktop App

```bash
cd desktop
npm install
npm run electron:dev
```

## Make It Yours

Ask dorabot to onboard you.

| File | Purpose |
|------|---------|
| `SOUL.md` | Personality and tone |
| `USER.md` | Who you are, your preferences |
| `MEMORY.md` | Persistent facts it should always remember |
| `AGENTS.md` | Extra instructions |

### Skills

Built-in skills include GitHub, email, macOS automation, image generation, and memes. Add your own by dropping a `SKILL.md` in `~/.dorabot/skills/your-skill/`.

### Config

`~/.dorabot/config.json`:

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

- Scoped file access (default: `~/`, `/tmp`)
- Sensitive dirs always blocked: `~/.ssh`, `~/.gnupg`, `~/.aws`
- Token-authenticated gateway
- Configurable tool approval tiers

## License

MIT
