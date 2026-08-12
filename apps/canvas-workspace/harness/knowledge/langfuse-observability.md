# Langfuse observability for Canvas Agent

Research date: 2026-08-11. Sources below are Langfuse's official docs and
official JS/TS SDK reference.

## Decision

**Yes — Canvas can send the complete host + Engine/Pi performance tree to
Langfuse without reusing `pulse-coder-plugin-kit/langfuse`.** Langfuse supports
manual nested observations, explicit start/end times, LLM generations, events,
deterministic trace correlation, sessions, background batching, and graceful
flush. The missing piece is a Canvas-owned adapter; Langfuse cannot infer the
host phases or connect both runtimes automatically.

The adapter belongs in the Electron main process, above
`resolveAgentRuntime()`. That is the only shared boundary which observes the
Canvas-owned queue/scope/context work and then surrounds either `Engine.run()`
or the embedded Pi `AgentHarness`. Engine- and Pi-specific probes should add
children beneath that host-owned root, not create separate traces.

## Capability check

| Requirement | Official capability | Canvas mapping |
| --- | --- | --- |
| Custom spans and nesting | `startObservation()` creates manual observations; an observation can create child observations. Manual observations must be ended. [Instrumentation](https://langfuse.com/docs/observability/sdk/instrumentation), [observation types](https://langfuse.com/docs/observability/features/observation-types) | One root per Canvas turn; nested host phases, runtime, generations, and tools. |
| Explicit timing | `StartObservationOptions` accepts `startTime`; `end()` accepts an explicit end time. [SDK option](https://langfuse-js-git-main-langfuse.vercel.app/types/_langfuse_tracing.StartObservationOptions.html), [span lifecycle](https://langfuse-js-git-main-langfuse.vercel.app/classes/_langfuse_tracing.LangfuseSpan.html#end) | Existing `requestStartedAt` through `completedAt` timestamps can be emitted without re-timing work. |
| LLM generations and TTFT | `generation` is an LLM-specific observation with model, usage and cost fields. `completionStartTime` is the native first-token timestamp. [Observation types](https://langfuse.com/docs/observability/features/observation-types), [TTFT](https://langfuse.com/docs/observability/sdk/advanced-features#time-to-first-token-ttft) | Engine model iterations and Pi model calls become generations; set `completionStartTime` from the first text callback belonging to that generation. |
| Point milestones | `event` is a discrete point-in-time observation. [Observation types](https://langfuse.com/docs/observability/features/observation-types) | Emit `first-stream-activity` (TTFA) and, when useful, `first-text` events. Langfuse has no special TTFA field; TTFA remains an event/metadata metric. |
| Trace/run/session correlation | Langfuse uses W3C trace IDs. `createTraceId(seed)` makes a deterministic 32-character trace ID; observation IDs are SDK-generated and cannot be arbitrary. Sessions group multi-turn traces. [Trace and observation IDs](https://langfuse.com/docs/observability/sdk/instrumentation#trace-and-observation-ids), [data model](https://langfuse.com/docs/observability/data-model) | Derive the Langfuse trace ID from Canvas `runId`; retain raw `runId`/`turnId` as metadata; propagate the Canvas chat session as `sessionId`. |
| Async export and shutdown | The processor batches in the background. `forceFlush()` awaits pending spans/media and `shutdown()` completes pending work. [Client lifecycle](https://langfuse.com/docs/observability/sdk/instrumentation#client-lifecycle--flushing), [processor reference](https://langfuse-js-git-main-langfuse.vercel.app/classes/_langfuse_otel.LangfuseSpanProcessor.html) | Never await network export on the chat path. Flush on an explicit diagnostic action if needed; await SDK shutdown from Electron app teardown. |
| Node/Electron | Current `@langfuse/tracing` and `@langfuse/otel` target Node.js 20+. `@langfuse/browser` is not the secret-key trace exporter. [SDK packages](https://github.com/langfuse/langfuse-js), [SDK setup](https://langfuse.com/docs/observability/sdk/overview) | Electron 30's main process embeds Node 20, so the documented runtime floor is met. Langfuse does not claim Electron support explicitly; bundling and a real main-process smoke test are still required. Never put the secret key or OTLP exporter in the renderer. |
| Privacy and self-hosting | The JS processor can mask each observation's input/output/metadata before export. Langfuse is open-source and self-hostable; self-hosted OSS can disable deployment telemetry, and raw traces/prompts are not part of that telemetry. [Masking](https://langfuse.com/docs/observability/sdk/advanced-features#mask-sensitive-data), [self-hosting](https://langfuse.com/self-hosting), [self-hosted telemetry](https://langfuse.com/self-hosting/security/telemetry) | Default Canvas tracing to metadata/timing only. Prompt, response, tool I/O, paths and canvas content require separate opt-ins and client-side redaction. Credentials remain main-process/env or secure settings only. |

## Recommended trace shape

```text
trace: canvas.agent.turn                 sessionId = Canvas chat session
  span: canvas.host.queue
  span: canvas.host.scope-activation
  span: canvas.host.context-preparation
  agent: runtime.engine | runtime.pi-agent-harness
    generation: model-call              (one per actual provider call)
    tool: <tool-name>                    (nested under its runtime/model step)
    event: first-stream-activity         (TTFA, with event type)
    event: first-text                    (optional visual milestone)
  span: canvas.host.response-processing
```

The duration spans should be exclusive phases so their widths add up to the
turn. TTFA and TTFT are milestones inside the runtime, not additive phases.
For TTFT analytics, set `completionStartTime` on the relevant generation; also
store turn-level `ttfaMs`/`ttftMs` in root metadata because a tool-using Engine
turn may contain several generations.

## Integration shape

The implementation uses a typed Canvas-owned event bus as the timing/event
SSOT. Runtime code publishes neutral events; the local DevTools sink and the
Langfuse plugin are independent subscribers. The chat path never imports or
awaits Langfuse.

Both observability subscribers are currently development-only and explicit
opt-ins. Start the dev app with `PULSE_CANVAS_AGENT_OBSERVABILITY=1`; the local
DevTools also requires its existing `canvas-agent-debug-trace` experimental
flag (or `CANVAS_AGENT_DEBUG_TRACE=1`). Langfuse additionally requires both
`LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY`. `LANGFUSE_BASE_URL` selects a
self-hosted deployment; `LANGFUSE_TRACING_ENVIRONMENT` and `LANGFUSE_RELEASE`
are forwarded when present. Packaged/production builds ignore these switches.
All credentials remain in the Electron main process. Media upload is disabled
and the event contract contains timing and structural metadata only—no
prompt/response content, tool arguments/results, or filesystem paths.

1. Canvas owns `AgentObservability` and a typed publish/subscribe bus. The
   local DevTools and Langfuse adapter consume it independently.
2. Initialize an isolated OpenTelemetry `NodeTracerProvider` plus
   `LangfuseSpanProcessor` once in Electron main when credentials and opt-in are
   present. Langfuse documents isolated providers but warns that mixing parent
   spans from different providers can orphan children, so all Canvas tree nodes
   must use the same provider. [Isolated provider](https://langfuse.com/docs/observability/sdk/advanced-features#isolated-tracerprovider)
3. Start the root at `CanvasAgentService.chatWithScope`, before the mutation
   lane, and finish it after Canvas response processing. The adapter can
   backfill the already-recorded timestamps using manual observation start/end
   times.
4. At `executeCanvasAgentSegment`, attach exactly one runtime child using the
   actual `resolveAgentRuntime()` result. This preserves correct attribution
   when Pi is enabled but a persona role still routes to Engine.
5. Add thin runtime probes rather than a second root trace:
   - Engine: Canvas-owned Engine hooks create one generation per
     `beforeLLMCall`/`afterLLMCall` pair and tool children for tool hooks.
   - Pi: wrap the provider/model call used by `AgentHarness`, or subscribe to
     the harness's model/tool events, to create generation and tool children.
     The official `pi-langfuse` extension shows that Pi sessions are traceable,
     but it is a separate Pi extension with its own privacy presets and is not a
     drop-in for Canvas's embedded harness. [Pi integration](https://langfuse.com/integrations/developer-tools/pi-agent)
6. Export asynchronously. Do not flush per token or await `forceFlush()` at
   turn completion. Electron's `before-quit` path awaits plugin teardown; the
   adapter force-flushes and shuts down its isolated provider there.

## Version choice and caveats

- Use the current modular JS/TS SDK v5 (`@langfuse/tracing`,
  `@langfuse/otel`, OpenTelemetry Node SDK), not the repository's legacy
  `langfuse@3.37.0` dependency. The current compatibility table identifies v5
  as current and v4 as the previous major. [Compatibility](https://langfuse.com/docs/compatibility)
- v5 propagates `sessionId`, `userId`, tags and trace metadata with
  `propagateAttributes()`. It also applies a smart export filter; observations
  created by Langfuse are included, but generic OpenTelemetry spans may need an
  explicit `shouldExportSpan` rule. [v4 to v5 migration](https://langfuse.com/docs/observability/sdk/upgrade-path/js-v4-to-v5)
- For self-hosted deployments, match the SDK/server compatibility table. The
  current OTel-based SDKs require a sufficiently recent server, and current v2
  observations/metrics APIs require Langfuse server v4. Do not build a new
  integration on the legacy batch-ingestion API. [SDK overview](https://langfuse.com/docs/observability/sdk/overview), [compatibility](https://langfuse.com/docs/compatibility)
- Electron compatibility is supported by the documented Node version, not by
  an explicit Electron guarantee. A real Electron 30.5.1 main-process smoke
  (embedded Node 20.16.0) successfully initialized an isolated provider,
  created agent + generation observations, updated TTFT, force-flushed,
  shut down, and exited cleanly. Repeat this smoke after SDK/Electron upgrades.

## Bottom line

Langfuse is a viable backend for the requested performance DevTools. It can
store and visualize the full Canvas Host → Engine/Pi tree and offers stronger
cross-run filtering and comparison than a local-only store. It does **not**
remove the need for Canvas-side instrumentation or the local compact DevTools
surface: Canvas must define the phase boundaries, attach the actual runtime,
and enforce privacy before exporting.
