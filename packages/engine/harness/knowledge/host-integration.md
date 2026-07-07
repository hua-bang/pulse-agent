# Host Integration Guide

How to embed the engine, learned from the four real hosts (cli, agent-teams, remote-server, canvas-workspace). Verified against `Engine.ts`, `core/loop.ts` (`LoopOptions`), and each host's wiring code.

## EngineOptions Essentials

- `disableBuiltInPlugins` — skip the default plugin array and hand-assemble your own (remote-server: `buildRemoteServerBuiltInPlugins()`; canvas: skills+MCP only). cli/agent-teams keep the defaults.
- `enginePlugins.plugins/.dirs/.scan` — extra plugins + disk-scan control (cli adds the memory integration here).
- `tools` — host tool injection, merged LAST with override priority (cli: `run_js`; remote-server: cron/analyze-image/worktree…; teammates: cwd-scoped `bash` + `team_*`).
- `model`/`modelType`/`llmProvider` at construction, overridable per `run()` — remote-server resolves a per-tenant provider each call via `buildProvider(type, {baseURL, apiKey, headers})`; canvas re-resolves each turn.
- `systemPrompt` — string replaces everything; function is re-invoked per request; `{append}` layers on the default/AGENTS.md base. remote-server uses `{append}` (keeps AGENTS.md awareness); canvas/teammates pass full strings (avoid cwd ambiguity).
- `logger` (`ILogger`) — flows into PluginManager.

## The Callback Surface (`LoopOptions`)

- `onText(delta)` — every text chunk; all four hosts stream it.
- `onToolCall` / `onToolResult` — tool-call frame and result; canvas unwraps the AI SDK v6 `{type,value}` output wrapper before display.
- `onToolInputStart/Delta/End` — progressive tool-input JSON keyed by `toolCallId`; only canvas wires these (live previews).
- `onStepFinish(step)` — per AI-SDK step; cli surfaces `finishReason` in its status line.
- `onResponse(messages)` — the step's response messages. The loop NEVER appends these to your `Context`; every host pushes them into its own persisted `context.messages` here.
- `onCompacted(newMessages, event?)` — compaction result; hosts replace `context.messages` wholesale (the loop also updates its own reference on the compaction path). remote-server additionally reports `event` to users.
- `onClarificationRequest(request) => Promise<string>` — REQUIRED by the built-in `clarify` tool (throws without it). cli parks on input; remote-server on a keyed queue with timeout; canvas on a pending-map resolved over IPC; agent-teams deliberately does not wire it.
- `abortSignal` — one AbortController per concurrent run; checked around every LLM call and tool step.
- `maxSteps` — per-run cap override (default 500); only canvas sets it (200).

## Four Host Patterns

- **cli** — one engine per process, one Context per session; full callback surface; fresh AbortController per message; same callback set reused for the ACP path (copy this when supporting native + external agents).
- **agent-teams** — one engine PER ACTOR (each Teammate/TeamLead); minimal callbacks (onText/onCompacted/onResponse/abort); wraps `bash`/`grep`/`ls` to default to the teammate's cwd and injects a "Working Directory" prompt block — because the engine has no per-run cwd option. Does not wire clarify.
- **remote-server** — process-wide singleton, stateless per call (safety = always pass a fresh loaded Context); per-tenant provider/model per run; abort per `platformKey`; clarification via keyed queue; `systemPrompt: {append}`.
- **canvas-workspace** — one engine PER WORKSPACE in a map, rebuildable via `reloadEngine()` with messages preserved; full surface incl. tool-input streaming + debug traces; `disableBuiltInPlugins: true` with workspace-then-global scoped skills/MCP config.

## Embedding Checklist

1. Own the Context: append via `onResponse`, replace on `onCompacted`, persist after the run — the engine won't do it for you.
2. Pick an engine lifecycle deliberately: singleton / per-session / per-actor / per-tenant map. Mismatch leaks plugin & tool state across users.
3. Wire `onClarificationRequest` (park/timeout/resolve) or the built-in clarify tool throws at your users.
4. Wire abort end-to-end: one controller per run, a cancel entry point, cancel pending clarifications with it.
5. Choose the plugin story explicitly: defaults for single-user hosts; `disableBuiltInPlugins` + hand-picked array for multi-tenant/embedded.
6. Multi-tenant? Resolve provider/model per call, not at construction.
7. Beware the global cwd: the default prompt reads `process.cwd()` and an AGENTS.md there REPLACES it (see `architecture.md` Prompt Resolution). Multi-tenant hosts should pass an explicit systemPrompt.
8. Need a per-run working directory? Wrap `bash`/`grep`/`ls` yourself + a prompt note (teammate pattern) — no engine option exists.
9. Persist `onCompacted` output together with `onResponse` output, or the next run rehydrates stale messages.
10. Host tools go in `EngineOptions.tools` — last-merge override beats plugin tools by name.
