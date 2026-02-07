# agent hardening — security + reliability + ux

based on review of openclaw and nanobot reference architectures vs our current implementation.

---

## critical — security

### 1. sender allowlist / channel gating
any stranger who texts the whatsapp number or telegram bot gets full agent access including bash execution. need sender filtering before the agent runs.

- add `channels.whatsapp.allowedSenders` / `channels.telegram.allowedSenders` to config
- check sender against allowlist in `channelManager.onMessage` before calling `handleAgentRun`
- default to owner-only if no allowlist configured
- **files**: `src/gateway/server.ts`, `src/channels/whatsapp/monitor.ts`, `src/channels/telegram/monitor.ts`, `src/config.ts`

### 2. gateway auth
ws port 18789 is open to anyone on the network. `config.get` leaks full config, `chat.send` lets anyone run prompts, `memory.save` lets anyone write to memory.

- add token-based auth on ws connection (shared secret in config, sent as first message or query param)
- reject unauthenticated rpc calls
- redact sensitive fields from `config.get` response (api keys, tokens)
- **files**: `src/gateway/server.ts`

### 3. permission mode safety
`bypassPermissions` applies globally — a whatsapp message from anyone gets the same permission level as the owner. channel messages should always use restricted permissions regardless of config.

- force `permissionMode: 'default'` for channel-originated runs
- only allow `bypassPermissions` for cli/desktop runs where the user is physically present
- **files**: `src/gateway/server.ts` (in `handleAgentRun`), `src/agent.ts`

---

## high — reliability

### 4. abort / timeout
no timeout on agent runs. if the sdk hangs or the agent loops, the session queue blocks forever. openclaw uses AbortController + configurable timeout with warnings.

- add `AbortController` per agent run
- configurable timeout (default 5min), abort the sdk query on expiry
- log warning when aborting
- clean up session queue entry on abort
- **files**: `src/gateway/server.ts`, `src/agent.ts`

### 5. session history truncation
sessions grow forever via jsonl append. after enough messages the context window overflows and the sdk errors out. nanobot does simple `messages[-50:]` truncation, openclaw does full compaction.

- start with simple approach: cap history at N messages when building context
- the sdk's `resume` already handles session state, but our jsonl files grow unbounded for the desktop ui
- consider a `/new` command to reset session
- **files**: `src/session/manager.ts`, `src/agent.ts`

### 6. request dedup
same message can be processed twice (baileys delivers duplicates, rapid taps on desktop). no idempotency check.

- track recent message hashes (content + sender + timestamp) in a ttl map
- skip if seen within last 30s
- openclaw pattern: idempotency key in request, dedup map with cached response
- **files**: `src/gateway/server.ts`

---

## medium — ux

### 7. duplicate reply suppression
agent sends reply via `message` tool during its run, then gateway auto-sends `result.result` back to the channel. user gets the same answer twice.

- track if the agent used the `message` tool during the run (flag on the tool handler)
- if it did, skip the auto-send in gateway
- openclaw does this with `didSendViaMessagingTool` tracking in the subscribe layer
- **files**: `src/gateway/server.ts`, `src/tools/messaging.ts`

### 8. stream delta throttling
every sdk event gets broadcast to all ws clients. desktop gets flooded with tiny text deltas.

- buffer text deltas and emit at most every 150ms (openclaw pattern)
- only broadcast tool events if verbose mode is on
- **files**: `src/gateway/server.ts`

---

## lower — architecture

### 9. message bus decoupling (nanobot pattern)
channels currently call `handleAgentRun` directly inside the `onMessage` callback. this couples channels tightly to the agent loop and blocks the subagent pattern.

- introduce async queue between channels and agent (inbound/outbound)
- channels push to inbound, agent loop consumes
- agent pushes to outbound, dispatcher routes to channels
- enables subagent spawning (push result back to inbound as system message)
- **files**: new `src/bus/` module, refactor `src/gateway/server.ts`

### 10. context window guard
no check on whether the model's context window can fit the session + system prompt before sending. openclaw checks context window size and blocks/warns if too small.

- resolve model context window from model id
- warn if session history is approaching the limit
- auto-truncate or suggest `/new` session
- **files**: `src/agent.ts`

---

## reference

- openclaw patterns: dedup, async ack, auth rotation, context guard, compaction, 7-layer tool policy, delta throttling, messaging tool duplicate tracking
- nanobot patterns: message bus, simple tool loop, session truncation, subagent spawn via bus re-injection
- our current state: direct channel→agent calls, no auth, no filtering, no timeouts, no truncation
