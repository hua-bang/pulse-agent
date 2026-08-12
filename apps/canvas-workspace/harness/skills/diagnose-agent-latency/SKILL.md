---
name: diagnose-agent-latency
description: Diagnose and optimize Canvas Agent turn latency with the development-only Agent DevTools or Langfuse traces. Use when a Canvas chat feels slow, TTFA/TTFT/first-render regresses, a run spends unexpected time in Canvas Host, Engine, Pi, tools, or Renderer, or a performance change needs a before/after trace comparison.
---

# Diagnose Agent Latency

Run a measurement-first loop. Attribute elapsed time to an owner before changing
code, change one bottleneck at a time, then repeat the same workload to prove the
result.

## 1. Establish a Reproducible Run

Work only in development mode. Observability is intentionally absent from
packaged production builds.

1. Record the prompt, scope, model/provider, runtime owner, attachment count,
   canvas node count, and whether the run is cold or warm.
2. Keep those inputs fixed across comparisons. Do not compare different models,
   scopes, prompts, or context sizes as if they were the same workload.
3. Run one warm-up and then at least three measured turns. Use the median for a
   local conclusion; use a larger Langfuse cohort when claiming a broad win.
4. Keep the raw `runId` for every sample.

Enable the local trace subscriber:

```bash
PULSE_CANVAS_AGENT_OBSERVABILITY=1 pnpm --filter canvas-workspace dev
```

Also enable `canvas-agent-debug-trace` in Settings → Experimental, then reload
the renderer. `CANVAS_AGENT_DEBUG_TRACE=1` enables main-process detail capture
for scripted runs, but the renderer DevTools route still requires the
experimental flag. Open `#/debug` or use the Debug Trace card on an assistant
message.

Use Langfuse when the task needs cross-run filters, cohorts, percentiles, or a
shared remote trace. Add `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, and
optionally `LANGFUSE_BASE_URL`. Never put credentials in source or renderer
state. Read `../../knowledge/langfuse-observability.md` before changing the
exporter or interpreting its trace model.

The built harness launches production output, so it cannot activate this
development-only DevTools plugin. Use `canvas-harness` for surrounding UI smoke
checks, but use the development launch above for latency traces.

## 2. Read the Timeline Correctly

Treat the lanes as ownership boundaries:

- **Canvas Host**: queue, scope activation, context preparation, runtime
  dispatch, and response processing.
- **Engine** or **Pi**: runtime execution. Attribute using the runtime label on
  the run, not the feature flag the operator expected.
- **Generation**: one provider/model call. Tool-using turns can have several.
- **Tool**: a named tool interval inside the runtime.
- **Renderer**: the first committed UI content milestone.

Interpret the summary metrics as follows:

- `Total`: request start through host completion.
- `TTFA`: first stream activity, which may be a tool call rather than text.
- `TTFT`: first user-visible text. It can legitimately be later than TTFA.
- `First render`: first assistant content committed by the renderer.
- `Bottleneck`: longest exclusive duration, not proof of root cause by itself.

TTFA and TTFT are point milestones inside runtime execution. Do not add them to
phase durations. Compare milestone deltas instead:

```text
pre-runtime      = runtime start - request start
activity wait    = TTFA - runtime start
text wait        = TTFT - TTFA
render lag       = first render - TTFT
post-runtime     = total - runtime end
```

If a timestamp is missing, report it as missing. Do not turn it into zero.

## 3. Localize the Bottleneck

Use this order:

1. Large queue, scope, or context phase: inspect Canvas Host work before the
   runtime. Check context size, canvas reads, synchronous work, and duplicated
   preparation.
2. Large activity wait with one generation: suspect provider latency, network,
   model queueing, or delayed runtime callbacks. Compare the same prompt across
   providers only as a separately named experiment.
3. Small TTFA but large text wait: inspect tool-first behavior, multiple model
   iterations, clarification, or reasoning before the first text. Do not label
   this as renderer slowness.
4. Long runtime after TTFT: inspect long generations, serial tools, repeated
   model calls, or work that needlessly blocks turn completion.
5. Large render lag: inspect stream batching, main-to-renderer IPC, React
   scheduling, and Markdown/render cost.
6. Large post-runtime tail: inspect response processing, persistence, trace
   serialization, and completion notifications.

Correlate the timeline with tool names and generation boundaries. A large
runtime bar only says the runtime owns the interval; its children explain what
happened inside it.

## 4. Map Evidence to Code

Start from the owner indicated by the trace:

- Event contract and bus: `src/shared/agent-observability.ts`,
  `src/plugins/main/agent-observability-bus.ts`
- Canvas Host phases: `src/main/agent/observability/host-run.ts`,
  `src/main/agent/service.ts`, `src/main/agent/canvas-agent.ts`
- Runtime selection: `src/main/agent/segment-execution.ts`
- Engine children: `src/main/agent/observability/engine-plugin.ts`
- Pi generations: `src/main/agent/observability/pi-generation-events.ts`,
  `src/main/agent/backends/pi-agent-harness-backend.ts`
- Renderer milestone: `src/main/agent/observability/renderer-mark.ts` and the
  chat stream renderer that publishes it
- Local model/UI: `src/plugins/renderer/devtools/performance-model.ts`,
  `AgentDebugPage.tsx`, `ChatDebugTrace.tsx`
- Remote exporter: `src/plugins/main/langfuse-observability.ts`

Do not optimize `packages/engine/src/core/loop.ts` merely because Canvas uses
Engine. First prove the slow interval is Engine-owned and not Canvas Host, Pi,
provider, tool, or Renderer time.

## 5. Run a Controlled Optimization Experiment

1. State one falsifiable hypothesis tied to one measured interval.
2. Choose the smallest code change that should move that interval.
3. Add or update a timing/behavior regression test when changing event
   boundaries, first-activity detection, runtime attribution, or renderer marks.
4. Run focused tests plus `node scripts/harness/run-harness-check.mjs`.
5. Repeat the fixed workload with the same model and context.
6. Compare medians and report the absolute and percentage change. Call out any
   regression in TTFA, TTFT, first render, total, errors, or output quality.
7. Revert or reject an optimization that only moves time between labels,
   suppresses instrumentation, drops work, or changes the workload.

For a performance-sensitive implementation, finish with the validation level
selected by `../validate-canvas-change/SKILL.md`.

## 6. Report the Result

Return a compact diagnosis with:

```text
Workload: prompt/scope/model/runtime/context, cold or warm
Samples: run IDs and count
Baseline: median Total, TTFA, TTFT, First render
Bottleneck: owner + interval + supporting child events
Hypothesis: causal mechanism, with confidence and alternatives
Experiment: one proposed or implemented change
Result: before/after absolute and percentage deltas
Validation: tests and trace comparison actually run
Privacy: whether only timing metadata or payload capture was enabled
```

Separate observation from inference. One trace can justify a targeted next
experiment, but not a general performance claim.
