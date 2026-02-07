# my-agent: Adopt Goodable Patterns — Full Implementation Plan

## Context

After reviewing Goodable's Claude Agent SDK integration, we're adopting their best patterns for skills, tools, system prompts, permissions, and execution control. This plan covers everything in priority-ordered phases.

## Phase 1: Execution Features (Cancel, PostToolUse, Stats)
Immediate UX wins on what we already have.

### 1a. Mid-execution Cancel
**Files**: `src/agent.ts`, `src/gateway/server.ts`, `src/gateway/types.ts`

- Store the `Query` instance returned by `query()` in a module-level `Map<string, Query>` keyed by sessionId
- Expose `agent.cancel` gateway RPC that calls `response.interrupt()` on the stored query
- Add `cancel` event type to gateway types
- Clean up map entry on completion or cancel
- Desktop: add cancel button to Chat view that calls `rpc('agent.cancel', { sessionId })`

### 1b. PostToolUse / PostToolUseFailure Hooks
**Files**: `src/hooks/index.ts`, `src/agent.ts`, `src/gateway/server.ts`

- Add `PostToolUse` default hook that:
  - Infers action type from tool name (Read/Edited/Created/Executed/Searched/Generated) — port Goodable's `TOOL_NAME_ACTION_MAP` and `inferActionFromToolName()`
  - Extracts file path from tool input (port `extractPathFromInput()`)
  - Broadcasts `agent.tool_result` with enriched metadata: `{ toolName, action, filePath, response (truncated 2KB) }`
- Add `PostToolUseFailure` hook that broadcasts `agent.tool_error` with error details
- Detect Write/Edit tools and broadcast `agent.file_change` event with path + content

### 1c. Conversation Stats
**Files**: `src/agent.ts`, `src/gateway/server.ts`

- On `result` message, extract `duration_ms`, `total_cost_usd`, `usage`, `num_turns`
- Broadcast `agent.stats` event via gateway
- Desktop: show cost/duration in Chat view after completion

---

## Phase 2: SDK Native Plugins + Skill Infrastructure
Switch from prompt injection to SDK's plugin system.

### 2a. Copy-to-user-dir Pattern
**Files**: new `src/skills/manager.ts`, modify `src/skills/loader.ts`, `src/config.ts`

- On startup, copy skills from `./skills/` to `~/.my-agent/user-skills/`
  - Skip if already copied for current version (track in `plugin-ex.json`)
  - Preserve `node_modules/` and `.venv/` during copy
  - User skills in `~/.my-agent/skills/` also copied (user overrides builtin)
- Generate `~/.my-agent/user-skills/.claude-plugin/plugin.json` with enabled skill paths
- Generate `~/.my-agent/user-skills/.claude-plugin/plugin-ex.json` with disabled list + version
- `loader.ts` still handles eligibility checks, but `manager.ts` handles plugin.json generation

### 2b. Switch query() to use plugins
**Files**: `src/agent.ts`

- Remove prompt injection (`matchSkillToPrompt` + prepending to prompt)
- Load enabled skill paths from manager
- Pass to query: `plugins: [{ type: 'local', path: userSkillsDir }]`
- Add `allowedTools: ['Skill', ...existing]` when plugins present
- Add `settingSources: ['project']` when plugins present
- Remove skill list from system prompt (SDK handles discovery)

### 2c. Skill Enable/Disable via Gateway
**Files**: `src/skills/manager.ts`, `src/gateway/server.ts`

- `skills.list` RPC: return all skills with enabled status
- `skills.toggle` RPC: enable/disable skill, update plugin.json + plugin-ex.json
- `skills.detail` RPC: return SKILL.md content + file tree
- `skills.import` RPC: import from path (directory or ZIP)
- `skills.delete` RPC: delete user skill (block builtin deletion)

### 2d. Global Env Vars for Skills
**Files**: `src/config.ts`, `src/skills/manager.ts`, `src/agent.ts`

- Skills declare required env vars in SKILL.md frontmatter: `requires.env: [API_KEY, ...]`
- Config gains `envVars: Record<string, string>` section
- Gateway RPCs: `config.getEnvVars`, `config.setEnvVars`
- On query(), inject configured env vars into the `env` option
- Desktop: env var configuration UI

---

## Phase 3: Interactive Tool Permissions
Approve/deny tool calls from desktop AND channels.

### 3a. Permission System
**Files**: new `src/permissions.ts`, modify `src/agent.ts`, `src/hooks/index.ts`

- Port Goodable's pattern: `addPendingPermissionAndWait()` returns `{ permission, waitPromise }`
- Define `READ_ONLY_TOOLS` set (Read, Glob, Grep, TodoWrite, WebFetch, WebSearch, Task)
- Define `EDIT_TOOLS` set (Write, Edit, NotebookEdit)
- `shouldAutoApprove(toolName, permissionMode)` logic
- Global permission store (`Map<string, PendingPermission>`) with Promise-based resolution
- 5-minute timeout for pending permissions (not 24h like Goodable)

### 3b. canUseTool + PreToolUse Hook
**Files**: `src/agent.ts`, `src/hooks/index.ts`

- When `permissionMode !== 'bypassPermissions'`, pass `canUseTool` callback to query()
- canUseTool: check shouldAutoApprove → if not, create pending permission + broadcast + wait
- PreToolUse hook as backup gate (same logic)
- Broadcast `agent.permission_request` event with: `{ id, toolName, toolInput, inputPreview }`

### 3c. Permission Resolution from Desktop + Channels
**Files**: `src/gateway/server.ts`, `src/channels/*/monitor.ts`

- Gateway RPC: `permissions.resolve` — takes `{ permissionId, approved: boolean }`
- Desktop: show permission dialog when `agent.permission_request` event received
- Channel integration: when agent is running from a channel context:
  - Send permission request as a message: "🔐 Permission needed: Bash `rm -rf node_modules`. Reply YES or NO"
  - Monitor for YES/NO reply, resolve the permission
  - Timeout after 5 min with denial

---

## Phase 4: System Prompt Overhaul
Make the agent actually understand itself and its environment.

### 4a. Runtime Context Block
**File**: `src/system-prompt.ts`

Add detailed platform awareness:
- What my-agent is (personal agent running on user's machine)
- What the gateway does (WebSocket server, connects desktop + channels)
- Which channels are connected and active
- What the user sees (desktop UI with chat, terminal feed, automation tabs)
- What tools are available and what each one does specifically (not just a list)

### 4b. Channel-Aware Response Formatting
**File**: `src/system-prompt.ts`

When `channel` is set:
- WhatsApp: keep responses short, no markdown tables (they don't render), use emoji for structure, split long responses
- Telegram: markdown works but keep it concise, use inline formatting
- Desktop: full markdown, code blocks, tables all work
- Console: plain text

### 4c. Consequence-Based Constraints
**File**: `src/system-prompt.ts`

Replace generic safety rules with specific consequences:
- "If you delete files without confirmation, the user loses data permanently — there is no undo"
- "If you run a long Bash command without showing it first, the user can't cancel it"
- "If you modify system files outside the working directory, you could break the user's environment"

### 4d. Task Complexity Routing
**File**: `src/system-prompt.ts`

Guide the agent on when to plan vs act:
- Simple task (single file read, quick answer): just do it
- Moderate task (edit a few files): explain what you'll do, then do it
- Complex task (multi-file changes, destructive ops): explain plan, wait for confirmation, then execute
- Batch operations: always show scope and get confirmation first

### 4e. Tool Behavior Rules
**File**: `src/system-prompt.ts`

Specific per-tool guidance:
- Bash: show command before running if it modifies anything. Never run rm -rf without confirmation.
- Write: always Read the file first if it exists. Show what you're creating.
- Edit: show the change you're making. Prefer Edit over Write for existing files.
- Memory: after completing meaningful tasks, save key context. Before starting tasks, search memory for relevant history.

### 4f. Memory Integration
**File**: `src/system-prompt.ts`

Explicit guidance on memory tool usage:
- Search memory at start of complex tasks for relevant context
- Save user preferences, project patterns, recurring tasks
- Don't save trivial or temporary information
- Reference saved memories when relevant

---

## Phase 5: Port Document Skills
Instant capability expansion.

### 5a. PDF Skill
**File**: new `skills/pdf/SKILL.md`

Port Goodable's PDF skill (English, adapted for our context):
- Text/table extraction (pdfplumber)
- PDF creation (reportlab)
- Merge/split (pypdf)
- Metadata, rotation, watermark, password protection

### 5b. DOCX Skill
**File**: new `skills/docx/SKILL.md`

Word document creation (docx-js), editing (OOXML), tracked changes.

### 5c. XLSX Skill
**File**: new `skills/xlsx/SKILL.md`

Spreadsheet processing with formula support (openpyxl), data analysis (pandas), financial model conventions.

### 5d. PPTX Skill
**File**: new `skills/pptx/SKILL.md`

Presentation creation with design principles, color palettes, typography, layout templates.

### 5e. Skill Creator (meta-skill)
**File**: new `skills/skill-creator/SKILL.md`

Teaches the agent how to create new skills properly.

### 5f. Meeting Insights Analyzer
**File**: new `skills/meeting-insights/SKILL.md`

Transcript analysis for communication patterns and behavioral insights.

---

## Phase 6: Desktop UI for Skill Management
**Files**: `desktop/src/views/Skills.tsx` (new), `desktop/src/App.tsx`, `desktop/src/hooks/useGateway.ts`

- New Skills tab in desktop sidebar
- Skill list with toggle switches (enabled/disabled)
- Skill detail panel: SKILL.md content, file tree, env var config
- Import button (select folder or ZIP)
- Delete button (user skills only)
- Env var configuration panel (global, from config)

---

## Verification

1. **Cancel**: start a long task, hit cancel, confirm agent stops and gateway broadcasts `task_interrupted`
2. **PostToolUse**: run a task, confirm tool results appear in desktop terminal feed with enriched metadata (action type, file path)
3. **Stats**: complete a task, confirm cost/duration/tokens appear in desktop
4. **Skills**: toggle a skill off, confirm it doesn't load. Toggle on, confirm AI can invoke it via Skill tool
5. **Permissions**: set permissionMode to default, trigger a Bash command, confirm permission request shows in desktop and channel
6. **System prompt**: test from WhatsApp — confirm responses are short and formatted for mobile. Test from desktop — confirm full markdown
7. **Document skills**: ask agent to "create a PDF report" — confirm it follows the skill instructions
