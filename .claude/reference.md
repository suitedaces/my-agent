I checked both repos. Here’s how the agent works in each, in practical terms.

**OpenClaw (`desktop/openclaw`)**
1. A request hits the gateway, gets validated/deduped, and is immediately ACKed as `accepted` before heavy work starts async.  
`/Users/ishan/Desktop/openclaw/src/gateway/server-methods/agent.ts:45`  
`/Users/ishan/Desktop/openclaw/src/gateway/server-methods/agent.ts:89`  
`/Users/ishan/Desktop/openclaw/src/gateway/server-methods/agent.ts:342`  
`/Users/ishan/Desktop/openclaw/src/gateway/server-methods/agent.ts:355`

2. `agentCommand` resolves session/workspace, applies run/session overrides, builds skill snapshot, picks model/provider, and wraps execution in model fallback logic.  
`/Users/ishan/Desktop/openclaw/src/commands/agent.ts:63`  
`/Users/ishan/Desktop/openclaw/src/commands/agent.ts:138`  
`/Users/ishan/Desktop/openclaw/src/commands/agent.ts:191`  
`/Users/ishan/Desktop/openclaw/src/commands/agent.ts:386`

3. Embedded runner queues work by session/global lanes, checks context-window limits, rotates auth profiles on failures, can compact overflowed sessions, and escalates failover cleanly.  
`/Users/ishan/Desktop/openclaw/src/agents/pi-embedded-runner/run.ts:71`  
`/Users/ishan/Desktop/openclaw/src/agents/pi-embedded-runner/run.ts:74`  
`/Users/ishan/Desktop/openclaw/src/agents/pi-embedded-runner/run.ts:120`  
`/Users/ishan/Desktop/openclaw/src/agents/pi-embedded-runner/run.ts:249`  
`/Users/ishan/Desktop/openclaw/src/agents/pi-embedded-runner/run.ts:382`

4. Each attempt builds a rich system prompt (skills/bootstrap/runtime), assembles sandbox/tool policy, locks and sanitizes transcript, streams events, handles timeout/abort, and supports image injection.  
`/Users/ishan/Desktop/openclaw/src/agents/pi-embedded-runner/run/attempt.ts:138`  
`/Users/ishan/Desktop/openclaw/src/agents/pi-embedded-runner/run/attempt.ts:209`  
`/Users/ishan/Desktop/openclaw/src/agents/pi-embedded-runner/run/attempt.ts:344`  
`/Users/ishan/Desktop/openclaw/src/agents/pi-embedded-runner/run/attempt.ts:395`  
`/Users/ishan/Desktop/openclaw/src/agents/pi-embedded-runner/run/attempt.ts:612`  
`/Users/ishan/Desktop/openclaw/src/agents/pi-embedded-runner/run/attempt.ts:757`

5. Streaming layer normalizes partial/final text, reasoning, tool outputs, and suppresses duplicate message echoes from messaging tools.  
`/Users/ishan/Desktop/openclaw/src/agents/pi-embedded-subscribe.ts:30`  
`/Users/ishan/Desktop/openclaw/src/agents/pi-embedded-subscribe.ts:31`  
`/Users/ishan/Desktop/openclaw/src/agents/pi-embedded-subscribe.ts:225`  
`/Users/ishan/Desktop/openclaw/src/agents/pi-embedded-subscribe.ts:415`

6. Tool access is policy-driven (global, provider, agent, group, sandbox, subagent) before execution.  
`/Users/ishan/Desktop/openclaw/src/agents/pi-tools.ts:114`  
`/Users/ishan/Desktop/openclaw/src/agents/pi-tools.ts:173`  
`/Users/ishan/Desktop/openclaw/src/agents/pi-tools.ts:179`  
`/Users/ishan/Desktop/openclaw/src/agents/pi-tools.ts:422`

7. Chat bridge turns agent events into `delta` + `final` output and filters tool events by verbosity.  
`/Users/ishan/Desktop/openclaw/src/gateway/server-chat.ts:148`  
`/Users/ishan/Desktop/openclaw/src/gateway/server-chat.ts:174`  
`/Users/ishan/Desktop/openclaw/src/gateway/server-chat.ts:216`

OpenClaw is an orchestration-heavy, production-style agent pipeline.

**Nanobot (`desktop/nanobot`)**
1. Message bus decouples channels from the agent loop.  
`/Users/ishan/Desktop/nanobot/nanobot/bus/queue.py:11`  
`/Users/ishan/Desktop/nanobot/nanobot/bus/queue.py:25`  
`/Users/ishan/Desktop/nanobot/nanobot/bus/queue.py:51`

2. `AgentLoop` consumes inbound message, gets/creates session, sets tool context, builds prompt/context, runs model, executes tool calls in a loop until final text or max iterations.  
`/Users/ishan/Desktop/nanobot/nanobot/agent/loop.py:25`  
`/Users/ishan/Desktop/nanobot/nanobot/agent/loop.py:109`  
`/Users/ishan/Desktop/nanobot/nanobot/agent/loop.py:143`  
`/Users/ishan/Desktop/nanobot/nanobot/agent/loop.py:189`  
`/Users/ishan/Desktop/nanobot/nanobot/agent/loop.py:193`  
`/Users/ishan/Desktop/nanobot/nanobot/agent/loop.py:200`

3. Context builder composes identity + bootstrap files + memory + skills summary, then adds history/current message (including base64 images).  
`/Users/ishan/Desktop/nanobot/nanobot/agent/context.py:13`  
`/Users/ishan/Desktop/nanobot/nanobot/agent/context.py:21`  
`/Users/ishan/Desktop/nanobot/nanobot/agent/context.py:28`  
`/Users/ishan/Desktop/nanobot/nanobot/agent/context.py:121`  
`/Users/ishan/Desktop/nanobot/nanobot/agent/context.py:161`

4. Tool registry is straightforward: register, schema export, validate, execute.  
`/Users/ishan/Desktop/nanobot/nanobot/agent/tools/registry.py:8`  
`/Users/ishan/Desktop/nanobot/nanobot/agent/tools/registry.py:34`  
`/Users/ishan/Desktop/nanobot/nanobot/agent/tools/registry.py:38`

5. Sessions are JSONL files under `~/.nanobot/sessions`, with simple history truncation and persistence.  
`/Users/ishan/Desktop/nanobot/nanobot/session/manager.py:61`  
`/Users/ishan/Desktop/nanobot/nanobot/session/manager.py:78`  
`/Users/ishan/Desktop/nanobot/nanobot/session/manager.py:136`

6. `spawn` creates background subagents with a reduced toolset; completion is posted back as a system message for the main loop to summarize.  
`/Users/ishan/Desktop/nanobot/nanobot/agent/tools/spawn.py:11`  
`/Users/ishan/Desktop/nanobot/nanobot/agent/subagent.py:20`  
`/Users/ishan/Desktop/nanobot/nanobot/agent/subagent.py:49`  
`/Users/ishan/Desktop/nanobot/nanobot/agent/subagent.py:179`

Nanobot is a simpler “classic tool-calling loop” architecture.

If you want, I can do a direct mapping next: which OpenClaw/Nanobot agent patterns your `my-agent` should copy first (in priority order).