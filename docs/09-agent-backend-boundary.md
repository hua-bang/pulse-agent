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

## Unified AgentRuntime boundary

`src/main/agent/backends/`:

- `types.ts` — `AgentRuntime { id, capabilities, runSegment(request) }`,
  `TurnSegmentRequest/Result`, and `AgentRuntimeCapabilities`
  (`nativeCanvasTools`, `clarifications: native|approval|none`,
  `historyFidelity: full|window`, `sessionResume: host|cli`).
- `engine-backend.ts` — the engine.run branch, verbatim.
- `external-cli-backend.ts` — the external CLI branch, verbatim.
- `index.ts` — `resolveAgentRuntime(role)`: external driver → CLI runtime;
  default assistant → Engine or Pi; persona roles → Engine. Deprecated
  `TurnBackend` / `resolveTurnBackend` aliases keep the first seam compatible.

The executor keeps the backend-agnostic policies: `streamedText`
accumulation (now on BOTH paths — previously the engine path skipped the
accumulator, so a hard-stopped engine segment lost its partial text from
the persisted session, contradicting agent-roles.md; code now matches the
documented rule), one `recordResponseMessages` recorder, and abort
normalization. Guards: `segment-execution.test.ts` (3 cases),
`backends/registry.test.ts`.

## Embedded Pi AgentHarness runtime (shipped)

The default assistant can run on embedded
`@earendil-works/pi-agent-core@0.83.0`; this intentionally does not depend on
`pi-coding-agent`, spawn a CLI, write Pi config files, or run an HTTP/SSE tool
bridge. Enable **Pi AgentHarness runtime** in Settings → Experimental. For
automation, `PULSE_CANVAS_AGENT_RUNTIME=pi|engine` overrides the persisted
choice.

- Canvas model configuration remains the credential/model SSOT. The adapter
  creates an in-memory Pi provider with the same model, base URL, headers, and
  API key. OpenAI providers use `openai-responses`, matching
  `@ai-sdk/openai` v3's callable-provider default; Anthropic providers use
  `anthropic-messages`. A real request against the configured custom gateway
  caught and pinned this distinction.
- Canvas/Engine remains the tool registry and policy SSOT. All tools are
  registered with Pi, but initial visibility comes from
  `Engine.createToolSession()`. Every execution returns through that session,
  preserving schema validation, before/after tool hooks, ask-mode/PTC,
  dynamic policy prompts, skills, MCP tools, and deferred-tool loading.
- Canvas's full host history is supplied rather than a rendered discussion
  window. Text, reasoning, assistant tool-call frames, structured tool
  results, and image tool results map back to Canvas. Historical user image
  and file parts are not yet rehydrated into Pi, so `historyFidelity: full`
  describes host-history ownership, not byte-for-byte multimodal fidelity.
  Canvas owns cross-turn persistence and compaction; Pi owns its within-turn
  model/tool loop. This avoids two competing durable session stores.
- Pi text/tool events feed the existing Canvas stream and persistence path.
  Abort is linked to `AgentHarness.abort()`. Active runs expose native
  `steer()` / `followUp()` on the runtime contract for host integrations;
  the current Canvas UI has no steering control yet.
- Provider failures are raised as failed Canvas turns rather than persisted as
  empty successes.

The current capability matrix is:

| Runtime | Native Canvas tools | Clarification | History | Compaction | Steering |
|---|---:|---|---|---|---|
| Engine | yes | native | full / host | native | none |
| Pi AgentHarness | yes | native through Engine tools | full / host | host | native |
| External CLI role | no | approval | window / CLI | CLI | none |

## Compatibility evidence

Upstream Pi packages declare Node `>=22.19.0`, while Electron 30.5.1 embeds
Node 20.16.0. The production Canvas bundle builds, and
`pnpm --filter canvas-workspace smoke:pi-electron` launches a real Electron
main process, constructs `AgentHarness + InMemorySessionRepo + fauxProvider`,
and must print `ELECTRON_PI_OK`. The smoke is bound in the Canvas harness
validation because package metadata alone cannot answer runtime compatibility.

This proves the paths Canvas uses today; it does not erase the upstream engine
range. Re-run the smoke whenever Pi or Electron is upgraded.

## Benchmark lane (parallel, headless — no UI coupling)

Task suite run against BOTH backends headlessly: engine via
`headless-run.ts`/engine API, pi via `pi -p`/`--mode json`. Deterministic
checks + one judge, results to a runs JSONL, pass-rate lift per engine
change with pi as the fixed external baseline (vitest-evals pattern per
the 08 doc). This lane measures harness quality on a level field and does
not depend on Phases 2–3.
