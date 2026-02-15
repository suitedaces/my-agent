# dorabot

Personal AI agent with multi-channel messaging, browser automation, and persistent memory.

## Architecture

- **Backend**: Node.js + TypeScript, Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`)
- **Gateway**: WebSocket RPC server on port 18789 (`src/gateway/server.ts`)
- **Desktop**: Electron + Vite + React in `desktop/`
- **Channels**: WhatsApp (Baileys), Telegram (grammy)
- **Database**: SQLite (`~/.dorabot/dorabot.db`) via better-sqlite3, WAL mode
- **Tools**: MCP server — `message`, `browser`, `screenshot`, `calendar` (4 tools), `goals` (4 tools)
- **Browser**: Playwright-core via CDP, persistent profile at `~/.dorabot/browser/profile/`, port 19222
- **Skills**: Markdown files in `./skills/` and `~/.dorabot/skills/`, YAML frontmatter for metadata
- **Providers**: Pluggable — Claude (Agent SDK, default) or OpenAI Codex (Codex SDK)
- **Calendar**: RFC 5545 iCal RRULE-based scheduling (replaced cron)

## Build

```bash
# backend
npm run build                        # tsc → dist/

# desktop (all-in-one via electron-vite)
cd desktop && npm run build          # → desktop/out/{main,preload,renderer}

# dev
npm run dev                          # gateway with auto-reload (tsx --watch)
npm run dev:desktop                  # desktop with HMR (electron-vite dev)
npm run dev:cli                      # interactive CLI mode
```

## Key Files

### Core
- `src/agent.ts` — `runAgent()` and `streamAgent()`, orchestrates SDK `query()` with config, skills, workspace, hooks
- `src/db.ts` — SQLite database singleton (`getDb()`), schema creation, WAL mode, foreign keys
- `src/system-prompt.ts` — dynamic system prompt builder
- `src/config.ts` — config loading, merging, path allowlisting via `isPathAllowed()`
- `src/workspace.ts` — loads SOUL.md, USER.md, AGENTS.md, MEMORY.md from `~/.dorabot/workspace/`
- `src/index.ts` — CLI entry point

### Gateway
- `src/gateway/server.ts` — WebSocket RPC server, 71 RPC methods, agent run queue, tool approval system
- `src/gateway/types.ts` — `WsMessage`, `WsResponse`, `WsEvent`, `SessionInfo` types
- `src/gateway/session-registry.ts` — in-memory session tracking, backed by SQLite `sessions` table
- `src/gateway/channel-manager.ts` — start/stop WhatsApp and Telegram monitors

### Sessions & Database
- `src/session/manager.ts` — SQLite-backed session/message storage (sessions + messages tables)
- `scripts/migrate-to-sqlite.ts` — one-time migration from legacy JSONL files to SQLite

### Providers
- `src/providers/index.ts` — provider factory, singleton management
- `src/providers/types.ts` — provider type definitions
- `src/providers/claude.ts` — Claude provider (Agent SDK, default)
- `src/providers/codex.ts` — OpenAI Codex provider (dynamic import)

### Channels
- `src/channels/types.ts` — `InboundMessage`, `ChannelHandler`, `SendOptions`
- `src/channels/whatsapp/` — Baileys socket, monitor, send/edit/delete, QR login
- `src/channels/telegram/` — grammy bot, long-polling runner, markdown→HTML conversion

### Tools
- `src/tools/index.ts` — MCP server creation, registers 12 custom tools
- `src/tools/messaging.ts` — `messageTool` + channel handler registry pattern
- `src/tools/browser.ts` — single tool with `action` discriminator, 37 actions (input, navigation, snapshots, scripts, console/network inspection)
- `src/tools/calendar.ts` — `schedule`, `list_schedule`, `update_schedule`, `cancel_schedule` (RFC 5545 RRULE)
- `src/tools/goals.ts` — `goals_view`, `goals_add`, `goals_update`, `goals_propose`
- `src/tools/screenshot.ts` — standalone screenshot tool

### Calendar
- `src/calendar/scheduler.ts` — iCal RRULE-based scheduler, auto-migration from legacy cron_jobs

### Browser
- `src/browser/manager.ts` — find Chromium, launch via CDP, singleton page
- `src/browser/refs.ts` — DOM snapshot → uid refs, resolve ref → Playwright Locator
- `src/browser/actions.ts` — 30+ action functions: open, snapshot, click, click_at, drag, type, fill, fill_form, select, press, hover, upload_file, scroll, cookies, evaluate, console/network inspection, pdf, etc.

### Skills
- `src/skills/loader.ts` — load from dirs, eligibility checks, prompt matching
- `skills/` — 9 built-in skills: agent-swarm-orchestation, github, himalaya, image-gen, macos, meme, onboard, polymarket, remotion

### Desktop
- `desktop/src/App.tsx` — root layout, 8-tab navigation, resizable 3-panel layout
- `desktop/src/hooks/useGateway.ts` — central state, WebSocket RPC, 40+ methods, event handling, streaming
- `desktop/src/views/` — Chat, Goals, Channel, Skills, Settings, Soul, Status, Tools
- `desktop/electron/main.ts` — Electron main process, tray, window management
- `desktop/electron/preload.ts` — context bridge for gateway token

## RPC Protocol

```
request:  { method: string, params?: object, id: string }
response: { result?: any, error?: string, id: string }
event:    { event: string, data: any }
```

Auth: token from `~/.dorabot/gateway-token` (hex, 64 chars), sent via `{method: 'auth', params: {token}}`.

## Data Flow

```
User message → CLI or Gateway RPC
  → runAgent() or streamAgent()
    → load config, eligible skills, workspace files
    → match skill to prompt (optional)
    → build system prompt
    → SDK query() with tools, hooks, sandbox
    → stream/yield messages
    → persist to SQLite
  → return AgentResult { sessionId, result, messages, usage }
```

Channel messages wrapped in `<incoming_message>` tags. Desktop auto-sends responses. WhatsApp/Telegram require agent to use `message` tool (tracked via `usedMessageTool` flag).

## Workspace

`~/.dorabot/workspace/` — user-editable files loaded into system prompt each session:

| File | Purpose |
|------|---------|
| SOUL.md | Persona, tone, behavior |
| USER.md | User profile, goals, context |
| AGENTS.md | Agent-specific instructions |
| MEMORY.md | Persistent facts, preferences |

YAML frontmatter is stripped before injection. `ensureWorkspace()` creates defaults for SOUL.md and USER.md.

## Skills

SKILL.md format with YAML frontmatter (`name`, `description`, `user-invocable`, `metadata.requires`).

Loaded from `config.skills.dirs` (default: `./skills/`, `~/.dorabot/skills/`). Matched to prompts via name or description keywords. Skill content prepended to user prompt when matched.

Eligibility checks: required binaries (`which`), env vars, config keys.

## Config

Loaded from (first found): explicit path → `./dorabot.config.json` → `~/.dorabot/config.json` → defaults.

Key settings:
- `model` — default `claude-sonnet-4-5-20250929`
- `permissionMode` — default | acceptEdits | bypassPermissions | plan | dontAsk
- `sandbox.enabled` — false by default
- `sandbox.mode` — off | non-main | all
- `security.approvalMode` — approve-sensitive | autonomous | lockdown

Path access: `isPathAllowed()` checks ALWAYS_DENIED list first (`~/.ssh`, `~/.gnupg`, `~/.aws`, `~/.dorabot/whatsapp/auth`, `~/.dorabot/gateway-token`), then allowed list (default: `~/`, `/tmp`). Channel-specific overrides supported.

## Patterns

- **Channel handler registry**: `registerChannelHandler(channel, {send, edit, delete})` at monitor startup, `getChannelHandler(channel)` in message tool
- **Per-session run queue**: `runQueues` map ensures one agent run at a time per session key, concurrent messages queued
- **Session keys**: `channel:chatType:chatId` (e.g., `whatsapp:dm:1234567890`, `desktop:dm:default`)
- **Two session IDs**: our `sessionId` (JSONL filename) and SDK's `sdkSessionId` (UUID for resume)
- **Status messages**: send "thinking..." on channel, edit with response or delete if agent used message tool
- **Streaming**: SDK generator yields `stream_event` with `content_block_start/delta/stop`, broadcast to WS clients
- **Tool approval**: 3 tiers (auto-allow, notify, require-approval), 5-minute timeout, inline keyboard on Telegram
- **Idle timeout**: 4 hours resets session on next message

## Gotchas

- WhatsApp `replyTo` is `string` but Baileys expects `{ key: any }` — don't pass directly
- Baileys `stanzaId` can be `null`, needs `|| undefined` for `string | undefined` type
- `import { WebSocket } from 'ws'` (not `import type`) when using `.OPEN` constant
- Desktop uses electron-vite — single `electron.vite.config.ts` handles main, preload, and renderer builds
- Single `tsconfig.json` covers both `src/` (renderer) and `electron/` (main/preload)
- Telegram parse mode always HTML, never Markdown — `markdownToTelegramHtml()` converts
- `page.accessibility.snapshot()` deprecated in Playwright 1.58+ — use DOM evaluation
- Browser refs invalidate after any navigation — always re-snapshot after clicking links
- WhatsApp JID: DM = `12345@s.whatsapp.net`, Group = `xyz@g.us`
- Telegram message timestamps are seconds (not ms) — multiply by 1000
- `cleanEnvForSdk()` strips VSCODE_* vars to prevent file watcher crashes
- Gateway token is in ALWAYS_DENIED — agent cannot read it
