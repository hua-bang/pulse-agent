# Agent Backend Boundary — pi as a native backend

Date: 2026-08-02
Goal: make the Canvas Agent's native chat run on a swappable turn backend,
so pi (earendil-works/pi) can power the default assistant next to the
built-in engine — first for side-by-side feel, then for measured
benchmarking (see `08-engine-harness-gap-vs-pi.md`).

## Why this boundary is the right cut

All chat integrity machinery (ActiveChatRegistry, SessionMutationCoordinator,
session CAS, clarification queue, session-store, stopped-vs-failed
normalization) is backend-agnostic already. The only engine-specific seam is
"execute one segment", owned by `executeCanvasAgentSegment`
(`apps/canvas-workspace/src/main/agent/segment-execution.ts`), which already
dispatched two ways (built-in engine vs external CLI drivers). The boundary
formalizes that dispatch; nothing above it changes.

## Phase 1 — TurnBackend boundary (SHIPPED with this doc)

`src/main/agent/backends/`:

- `types.ts` — `TurnBackend { id, capabilities, runSegment(request) }`,
  `TurnSegmentRequest/Result`, and `TurnBackendCapabilities`
  (`nativeCanvasTools`, `clarifications: native|approval|none`,
  `historyFidelity: full|window`, `sessionResume: host|cli`).
- `engine-backend.ts` — the engine.run branch, verbatim.
- `external-cli-backend.ts` — the external CLI branch, verbatim.
- `index.ts` — `resolveTurnBackend(role)`: external driver → CLI backend,
  else engine. The single extension point for new backends.

The executor keeps the backend-agnostic policies: `streamedText`
accumulation (now on BOTH paths — previously the engine path skipped the
accumulator, so a hard-stopped engine segment lost its partial text from
the persisted session, contradicting agent-roles.md; code now matches the
documented rule), one `recordResponseMessages` recorder, and abort
normalization. Guards: `segment-execution.test.ts` (3 cases),
`backends/registry.test.ts` (5 cases).

## Phase 2 — pi as an external role family (cheap, optional but useful)

Add `family: 'pi'` to `AGENT_ROLE_EXTERNAL_FAMILIES` with a `pi.ts` adapter
beside `claude-code.ts`/`codex.ts`:

- Spawn: `pi --mode json -p <prompt via stdin>` (LDJSON events), or RPC
  mode if session flags require it.
- Events: map pi's `message_update` deltas → `onText`;
  `tool_execution_start/end` → the shared `startTool`/`finishTool` helpers.
- Resume: pi session id per (chat-session × role) in the existing
  external-agent-state store.
- Env override `PULSE_CANVAS_PI_CMD`; probe via `pi --version`.

Value: @pi vs @engine in ONE group chat = immediate harness feel
comparison (persona-window fidelity), zero new surfaces. Measures raw
harness quality, NOT native integration depth — say so wherever results
are shown.

## Phase 3 — pi as a native default backend

`piTurnBackend` implementing `TurnBackend`, selected for the DEFAULT
assistant (null role) by per-scope config behind an experimental flag
(dev instrument, not a product feature — per the focus plan's
no-orchestration-platform stance).

Two integration options, decided at implementation time:

1. **SDK embed (preferred for depth)** — `@earendil-works/pi-agent-core`
   in the Electron main process: `new Agent({ initialState: {
   systemPrompt, model, tools, messages } })`. Canvas tools
   (`createCanvasTools(workspaceId)`) adapt to pi `AgentTool`s (same
   process, same functions). Pi events (`message_update`,
   `tool_execution_*`) map onto the request's `onText`/`onToolCall`/
   `onToolResult`. `agent.abort()` wires to the segment's AbortSignal.
   System prompt and injected workspace context carry over unchanged
   (they're strings we already assemble). Capability matrix:
   `nativeCanvasTools: true, clarifications: 'none' (first cut),
   historyFidelity: 'full' (map ModelMessage ↔ AgentMessage),
   sessionResume: 'host'`.
2. **RPC subprocess (preferred for isolation)** — pi's RPC mode with
   JSONL framing; keeps pi's dependency tree out of the app bundle;
   costs message mapping over a process boundary and per-turn spawn/
   session management.

Open items tracked for Phase 3: ModelMessage↔AgentMessage mapping
(tool-call frames especially), clarify/approval story (pi has no native
clarification — capability matrix drives UI degradation), model parity
config (pin the SAME provider+model on both backends or comparisons are
meaningless), and compaction ownership (pi-internal vs host).

## Benchmark lane (parallel, headless — no UI coupling)

Task suite run against BOTH backends headlessly: engine via
`headless-run.ts`/engine API, pi via `pi -p`/`--mode json`. Deterministic
checks + one judge, results to a runs JSONL, pass-rate lift per engine
change with pi as the fixed external baseline (vitest-evals pattern per
the 08 doc). This lane measures harness quality on a level field and does
not depend on Phases 2–3.
