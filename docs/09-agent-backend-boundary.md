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

## Phase 2 — pi as an external role family (SHIPPED)

`family: 'pi'` in `AGENT_ROLE_EXTERNAL_FAMILIES` + `external/pi.ts`
beside `claude-code.ts`/`codex.ts`:

- Spawn: `pi --mode json -p`, prompt via stdin; resume via
  `--session <id>` (the id arrives in the stream's FIRST line —
  `{"type":"session","id":…}`).
- Events: `message_update` `text_delta` → `onText` (thinking deltas
  ignored); last assistant `message_end` = authoritative reply;
  `stopReason:'error'` → run error; `tool_execution_start/end` → shared
  `startTool`/`finishTool` chip helpers.
- Stale resume prints `No session found matching '<id>'` (verified
  against the real 0.83.0 binary) — matches the shared
  `RESUME_FAILURE_RE` retry with zero adapter code.
- Env override `PULSE_CANVAS_PI_CMD`; probe via `pi --version`; Settings →
  Chat Roles driver picker offers pi.
- Guards: `src/main/agent/__tests__/pi-driver.test.ts` (8 cases: parser
  fixtures captured from the real CLI, argv/env wiring, fake-CLI
  orchestration incl. stale-resume retry).

Value: @pi vs @engine in ONE group chat = immediate harness feel
comparison (persona-window fidelity), zero new surfaces. Measures raw
harness quality, NOT native integration depth — say so wherever results
are shown.

## Phase 3 — pi as a native default backend

**v1 SHIPPED (subprocess variant):** `piNativeTurnBackend`
(`backends/pi-native-backend.ts`) runs the DEFAULT assistant (null role)
on the local pi CLI behind the `pi-native-chat` experimental flag
(default off; `PULSE_CANVAS_PI_NATIVE_CHAT` env escape hatch, read per
turn). It reuses the proven external-segment primitives — cwd resolution
into the workspace root, per-chat-session pi continuity in the external
state store (sentinel id `__pi_native_chat__`), stale-resume retry, and
the ask-mode approval gate — but renders a NATIVE assistant prompt (no
group-chat role protocol). Persona and external roles are unaffected;
`resolveTurnBackend` diverts only the null-role segment. Honest
capability matrix: no canvas tools yet, window fidelity, CLI-owned
sessions. Guards: `backends/pi-native-backend.test.ts` (default-assistant
e2e on a fake pi incl. chips, reply append, and stale-resume retry),
`backends/registry.test.ts` (flag routing).

**v2-full SHIPPED (Engine tool bridge):** pi chats now get the current
scope's policy-visible Engine tool table through pi's extension system.
The app ships
`resources/pi-extension/pulse-canvas.ts` (extraResources → `pi-extension/`
packaged, env override `PULSE_CANVAS_PI_EXTENSION`), attached per run via
`-e`. Before spawning, main creates an Engine tool session that runs the same
`beforeRun` and `beforeLLMCall` policies as native Canvas Agent, writes its
initial table to a mode-0600 manifest, and binds a random, short-lived bridge id plus
an independent 256-bit bridge credential to the
Engine, workspace context, AbortSignal, clarification callback, and execution
mode. The extension dynamically registers every manifest tool and calls the
authenticated loopback `POST /pi-tools/call`; main executes it through the
Engine tool session, including schema validation and the same before/after
tool hooks used by native Canvas Agent. Tool-search results advance the native
policy state and reconcile the complete visible tool table (including newly
visible deferred tools, removals, and updated definitions) for
pi's next step. This preserves Ask-mode approval,
tool-result offload, plugin policy, cancellation, and workspace isolation.
Pi launches with `--no-builtin-tools`, so its own file/shell tools cannot
bypass Engine policy. Global chats receive the corresponding policy-filtered
global Engine tool table; workspace chats receive the workspace table.
The authenticated pi route accepts bounded 1 MiB inputs for large document and
artifact patches; other runtime-control routes remain at 64 KiB. Capability matrix:
engine and pi-native are `full`, external CLIs are `none`.

SDK embedding was rejected for this release because pi 0.83 requires Node
22.19 while Electron 30 embeds Node 20. The subprocess boundary preserves
runtime compatibility without duplicating Canvas tool implementations.
Guards: `backends/pi-tool-bridge.test.ts`,
`__tests__/pi-extension.test.ts`, `backends/pi-native-backend.test.ts`, and
`packages/engine/src/Engine.tools.test.ts`.

Open fidelity items remain ModelMessage↔AgentMessage mapping (tool-call frames
especially) and compaction ownership (pi-internal vs host). Model parity is SHIPPED: the pi-native
backend mirrors the canvas model config (provider type, base URL, key,
model id — third-party compatible APIs included) into a canvas-owned pi
config dir (`~/.pulse-coder/canvas/pi-agent/models.json`, 0600, override
`PULSE_CANVAS_PI_BRIDGE_DIR`) and pins it via `PI_CODING_AGENT_DIR` +
`--provider canvas --model <id>`, so both backends call the SAME
upstream; without a usable key it falls back to the user's own pi config.
This also makes canvas-run pi hermetic (its sessions live under our dir,
the user's personal `~/.pi` is untouched). Guard:
`backends/pi-model-bridge.test.ts` + the provider/dir echo cases in
`backends/pi-native-backend.test.ts`.

## Benchmark lane (parallel, headless — no UI coupling)

Task suite run against BOTH backends headlessly: engine via
`headless-run.ts`/engine API, pi via `pi -p`/`--mode json`. Deterministic
checks + one judge, results to a runs JSONL, pass-rate lift per engine
change with pi as the fixed external baseline (vitest-evals pattern per
the 08 doc). This lane measures harness quality on a level field and does
not depend on Phases 2–3.
