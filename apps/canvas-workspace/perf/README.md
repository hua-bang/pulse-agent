# Performance evaluation

Ratchet-gated performance checks for canvas-workspace. Guards derive from the
findings in `../docs/performance-analysis-consolidated.md` (+ round 3).
System design — the six aspects, the full metric dictionary (IDs, definitions,
gate levels), recording schema, and roadmap — lives in **`program.md`** (SSOT);
this file only covers how to run things.

The bundle/install-size workstream has a self-contained execution handoff in
**`bundle-optimization-plan.md`**: verified baselines, achievable targets,
phased task cards, risks, and acceptance commands. Agents changing build
minification, lazy boundaries, dependency classification, or packaging should
read it before implementation.

For a presentation-friendly view of the current state, actions, and expected
benefits, open **`bundle-optimization-overview.html`** directly in a browser.

After producing a macOS arm64 release, run `pnpm --filter canvas-workspace
perf:package` to record DMG, unpacked app, ASAR, native unpacked, and Electron
locale metrics in `perf/out/package-report.json`.

## One command (start here)

```bash
pnpm --filter canvas-workspace perf:report
```

Runs the whole pipeline — build → bundle gate → launch the app headless →
runtime scenarios → close → assemble the report — prints the verdict, and
writes `out/dashboard.html` (open in a browser) + `out/report.json` (verdict +
target/Gate summaries + alerts + metrics, for agents/CI). Exit 1 if any Gate failed or a full report
does not cover every **core** metric in `metrics.json` (`--bundle-only` is
exempt). Optional CDP-trace diagnostics have their own coverage status and do
not make the core report fail when the browser protocol is unavailable.

Variants: `--bundle-only` (fast, no app launch), `--no-build` (reuse `dist/`),
`--seed-nodes 300` (larger canvas), `--seed-webpages 40 --seed-url-webviews 25`
(a WebView-isolation fixture with 25 real Electron guests inside a 40-webpage
mix), `--repeat 1` (single boot — faster but
noisier; default is 3, see below). A full report deletes any stale
`out/scenarios-report.json` before launch and exits non-zero if the app can't
launch or the replacement runtime report is missing or invalid; use
`--bundle-only` when a runtime run is intentionally out of scope. First run on a display-less host
needs `apt-get install -y xvfb` and, if the Electron binary is missing,
`pnpm --filter canvas-workspace setup:electron`.
The CDP driver also needs a Node runtime with a global `WebSocket`; Node 20
fails with `WebSocket is not defined`, while the repository's current Node 24
runtime works.

Agents use the same command via the `perf-report` skill
(`.pulse-coder/skills/perf-report/SKILL.md`).

The individual steps below are exposed for debugging / partial runs.

## Bundle (no app launch needed)

```bash
pnpm --filter canvas-workspace build
pnpm --filter canvas-workspace perf:bundle
```

Measures the built renderer (entry raw/gzip, total JS, heavy-lib probes),
compares against the bundle-scoped policies in `baselines.json`, writes `out/bundle-report.{json,html}`.
Exit 1 on regression. The static companion gate `src/main/__tests__/bundle-boundaries.test.ts`
runs with the normal test suite and keeps mermaid dynamic-only.

**A5 · per-dependency attribution**: `PULSE_CANVAS_PERF_ANALYZE=1 pnpm build`
turns on `entryDepStatsPlugin` (electron.vite.config.ts) — reads Rollup's own
per-chunk module render-size stats (no new dependency, no extra build cost)
and writes `out/entry-dep-stats.json`. `perf:bundle` picks it up automatically
if present and adds `entryDepAttribution` (per-package KB + app's own code) to
`bundle-report.json`; `perf:report` always sets the env var, so a normal
`perf:report` run has this by default. Missing the file (e.g. `perf:bundle`
run standalone without the flag) just omits the section — no error.

## Runtime scenarios (drives the real app)

```bash
pnpm --filter canvas-workspace setup:electron    # only if the binary download was skipped/blocked
PULSE_CANVAS_PERF=1 pnpm --filter canvas-workspace harness start --profile temp --force --build
pnpm --filter canvas-workspace perf:scenarios --seed-nodes 100
pnpm --filter canvas-workspace harness close --cleanup
```

Set `PULSE_CANVAS_PERF=1` on the **harness start** command so the Electron main
process enables startup, loop-delay, save, and session-persistence sampling;
setting it only on the later scenario driver cannot retroactively enable those
process-level probes.

Real URL WebView fixtures are accepted only for `profile=temp`. `demo`,
`clone`, and `real` fail before any loopback URL is persisted. Always finish a
manual temp run with `close --cleanup`, including when the scenario command
fails (put cleanup in a shell `trap` / caller `finally`). Add `--headless` to
the `harness start` command on display-less Linux; see
`harness/tools/driver/README.md`. `perf:report` starts and cleans up this profile
automatically. `perf:scenarios` synchronously removes a stale
`perf/out/scenarios-report.json` before collecting a replacement report.

## Dashboard (from real data)

```bash
pnpm --filter canvas-workspace perf:dashboard
```

Normalizes whatever reports exist in `out/` into the recording schema
(`out/metrics-latest.json`, plus an append to `history/` for per-machine
trends), runs the rule engine, and emits two artifacts: `out/dashboard.html`
for humans and `out/report.json` (verdict + alerts + metrics) for agents.
Metric definitions come from `metrics.json`; metrics without values render as
未建/已埋待采 so coverage gaps stay visible. Within each topic, the dashboard
shows `primary` metrics as P0 summary cards, groups `supporting` metrics by
dimension under P1, and keeps `diagnostic` evidence under P2. P1/P2 groups are
collapsed by default, but a failed or directly-alerted metric opens its group
automatically. `level` (gate behavior), `coverageClass` (report completeness),
and `displayPriority` (visual hierarchy) are deliberately independent.

Coding agents consume this via the `perf-report` runtime skill
(`.pulse-coder/skills/perf-report/SKILL.md`): run the pipeline, read
`report.json`, summarize verdict/alerts, and pin the dashboard to the canvas
with `artifact_create` + `artifact_pin_to_canvas`.

Scenarios drive input via CDP and read `window.__pulsePerf`:

| Scenario | What it does | Gate |
|---|---|---|
| `startup` | parses the `[perf] startup` main-process phase line + renderer marks | informational |
| `renderer-trace` | reloads the built renderer once under CDP, records lab LCP/CLS, shift count, FCP→Canvas and Canvas→LCP blocking, Long Tasks + CPU counters, and saves a compressed Chrome trace | diagnostic/record-only |
| `image-memory` | mounts 10 unique 4000×3000 image nodes and sums decoded pixel bytes | `memory.image.decoded_mb` record |
| `chat-stream` | replays 521 deterministic code/Markdown deltas, then forces one same-content settled rerender; after ending the measured window it collapses the in-flow right dock and waits for its layout transition so later canvas scenarios keep the full viewport | frame rate, Markdown render/cache evidence, Mermaid tail |
| `typing` | types 120 chars into the first file node | `nodes-array-replace` counter (finding I-1) |
| `resize` | resizes a node from its bottom-right corner over 90 steps | `nodes-array-replace` + `canvas-save-ipc` counters (finding A2 resize) |
| `drag` | drags the first node header 90 steps | `nodes-array-replace` counter (finding A2) |
| `zoom-cold` | waits for an idle canvas, sends exactly one ctrl+wheel over blank canvas, keeps the legacy next-rAF sample, then confirms the transform write and crosses one later rAF boundary | record-only until compatible history exists |
| `panzoom` | pans (plain wheel) + zooms (ctrl+wheel) over blank canvas, verifies an eventual transform change, records the legacy capture→rAF scheduling probe, and measures frame smoothness | frame evidence; scheduling probe is diagnostic/record-only |
| `zoom-settle` | after an idle precondition, sends a 20-step Ctrl+Wheel gesture and keeps measuring through moving-idle, a 160ms transition allowance, and two final rAF boundaries | default diagnostic/record-only tail-latency and frame evidence |
| `panzoom-trace` | explicit-only pan+zoom trace that remains open through moving-idle and the scale transition, then attributes renderer/GPU/raster work | heavyweight diagnostic/record-only |
| `webview-lifecycle` | explicit-only same-guest 1s native geometric-offscreen → 1s visible viewport-relocation activity comparison with identity/state/geometry-restore/cleanup proof | diagnostic; native lifecycle contrast, not a CSS incremental-benefit measurement |
| `webview-discard-restore` | explicit-only Chrome-style live guest cap, LRU discard, RSS release, and state-aware reload proof | diagnostic; guest-count/RSS/restore metrics |
| `pty-stream` | streams deterministic output through two real PTYs and counts renderer `pty:data` events | `main.pty.ipc_per_sec` record |

Resize's Event Timing value only covers discrete pointerdown/up events; it
does not measure continuous pointer-move latency. Treat it as record-only and
use `frames_over20_pct` plus `frames_over20_pct_max` for resize smoothness.
`zoom-cold` means the first wheel of an idle gesture, not a cold Electron
process launch. It runs before `panzoom`, requires both moving flags to be
clear, and rejects any run that observes anything other than one wheel or an
actual transform change. `first_wheel_to_next_frame_ms` remains the original
capture-listener→next-rAF field for report/history compatibility; because that
rAF is queued before React's wheel handler, it can mark the frame start before
`useCanvas` writes the transform. The primary cold-zoom evidence is therefore
`first_wheel_to_presented_frame_ms`: after event propagation, a microtask queues
an observation rAF behind the app's transform rAF, the probe requires computed
`.canvas-transform` to differ, and then it waits one additional rAF. This
crosses a browser rendering opportunity and is a **presented-frame boundary
proxy**, not a GPU presentation or `SwapBuffers` timestamp. It intentionally
has no numeric policy yet; compatible same-machine history must exist before
adding a target or Gate.

The scenario report keeps `wheelToPresentedFrame.transformObservedP95` (the
first rAF that reads a changed transform), `wheelToPresentedFrame.p95` (the
following rAF boundary), and `framesUntilTransform` / `framesAfterTransform`
as proof fields. Repeats preserve `raw.wheelToPresentedFrameP95` and
`raw.wheelToTransformObservedP95` before taking medians.

Pan/zoom no longer reports a structural zero INP: wheel is outside the Event
Timing discrete-interaction set. Its retained `wheel_to_next_frame_p95_ms`
probe starts in a capture listener and can queue its rAF before the React
handler writes the transform, exactly like the legacy cold-zoom probe above.
It is therefore a **scheduling diagnostic**, not visible response or presented
frame latency, and has no target, warning, or Gate. Continuous pan/zoom feel is
supported only by `frames_over20_pct` plus the single-run worst-case
`frames_over20_pct_max`; the first idle wheel uses cold zoom's stricter
presented-frame proxy. Frame windows freeze after the action's final double-rAF
while save/counter collection continues separately.

`zoom-settle` is part of the default release workload so the post-input tail
cannot regress outside the shorter `panzoom` active window. Its
`last_wheel_to_rest_ms` starts at the final Ctrl+Wheel and ends only after both
moving flags clear, the fixed 160ms transition allowance elapses, and two rAF
boundaries pass. The value therefore intentionally contains the product's
180ms moving-idle debounce and transition floor; it is an end-to-end tail
duration, not pure JS work. Its median and single-run worst
`frames_over20_pct` values are record-only diagnostics. `panzoom-trace` uses
the same full-tail semantics but remains explicit-only because Chrome tracing
is substantially heavier.

`--seed-nodes N` grows the welcome canvas to N persisted nodes and reloads it.
`--seed-webpages M` makes exactly M of that final canvas's nodes webpage nodes
when capacity permits; without `--seed-url-webviews` they are deterministic
local HTML iframes. The default remains 0. The selected webpage slots are spread
across the seeded grid rather than estimated
with a stride, so `--seed-nodes 86 --seed-webpages 40` reports 40, not 43.
The temp profile's real three-node welcome base contains one HTML webpage
(`node-welcome-download`). Exact 100/0/0 normalizes that known disposable node
to text; exact 86/40/25 keeps it as HTML and adds 39 webpages, 25 of them URL
WebViews. Only that known temp-base node and `perf-seed-*` nodes may be
rewritten. An unknown user webpage that makes M/U impossible fails the run.

`--seed-url-webviews U` makes U of those M webpage slots URL-mode nodes backed
by real Electron `<webview>` guests (`0 ≤ U ≤ M ≤ N`). The runner starts a
random-port server bound only to `127.0.0.1`; each URL serves self-contained
HTML with no external requests. Before any measured scenario it verifies the
persisted N/M/U composition, then requires exactly U matching seeded loopback WebViews with the
expected fixture id and URL, `isLoading() === false`, and the guest-window
readiness marker. Each item must also expose its actual positive Electron
`webContentsId` and a per-document random `instanceToken`. After the
successfully completed zoom/pan diagnostics or `webview-lifecycle` scenario, the runner
rechecks the same URL, marker, WebContents id, and document token; only an
exact match records `statePreserved:true`. It also writes
`stateCheckedAfterScenarios` with the completed interaction scenarios covered
by that check. Startup/trace-only and other runs without zoom or pan keep
`statePreserved:null` and an empty scenario list while retaining the initial
readiness evidence. This detects both guest replacement and an in-place
document reload. The report records this proof under
`scenarios-report.json.fixture` (`requested`, `observed`, `readinessMarker`,
`statePreserved`, and per-WebView
`id/url/isLoading/marker/webContentsId/instanceToken` before and after the
interactions). A prior `perf-seed-*` URL fixture
can be refreshed to the new random port. If the canvas is already at or above
N and the requested type mix cannot be reached without rewriting unrelated
nodes, the command fails explicitly; use the documented temporary profile
instead of silently benchmarking the wrong mix.

`webview-lifecycle` is an explicit diagnostic and is not part of the default
scenario list. Run it against the representative disposable fixture:

```bash
pnpm --filter canvas-workspace perf:scenarios \
  --seed-nodes 86 --seed-webpages 40 --seed-url-webviews 25 \
  --scenario webview-lifecycle
```

The scenario waits for a geometrically offscreen loopback guest, installs a
guest-local rAF/10ms-interval probe plus a DOM-state canary, and compares two
fixed 1s windows on that same guest: native geometric offscreen, then temporary
viewport relocation. The report records initial total/offscreen/intersecting
guest counts and both activity deltas as a **native lifecycle phase contrast**.
A controlled same-geometry A/B found no incremental rAF/timer or trace benefit
from adding `visibility:hidden`; the production Observer/class experiment was
therefore removed instead of adding per-guest lifecycle machinery without a
measured benefit. The target's original `translate`/z-index are restored before
the offscreen condition is rechecked. The scenario succeeds only when the same
WebContents id, document instance token, readiness marker, and DOM state
survive, geometry is restored, and the injected rAF/interval are
removed. Missing guests, no offscreen sample, unsupported guest execution,
insufficient visible activity, absent lifecycle contrast, failed geometry
restore, or failed cleanup all fail the command; none are emitted as a
synthetic zero.

`webview-discard-restore` is the production deep-sleep diagnostic and is also
explicit-only. Run it with enough real guests to exceed the live cap:

```bash
pnpm --filter canvas-workspace perf:scenarios \
  --seed-nodes 100 --seed-webpages 47 --seed-url-webviews 29 \
  --scenario webview-discard-restore
```

The renderer keeps at most 16 unprotected URL WebViews live after a 60-second
offscreen grace period. A shared LRU coordinator wakes near-viewport nodes,
keeps meaningfully visible, selected, fullscreen, resizing/editing, focused,
loading, audible, DevTools-inspected, and dirty-form guests protected, and
rechecks visibility after its asynchronous safety probe. It does not reconcile
during canvas motion. A discarded node becomes a static memory-saver card;
restoring it creates a new WebContents/document and recovers the latest runtime
URL and scroll position. Cookies and persistent web storage remain in the same
session partition, but arbitrary JS heap, sockets, media position, and in-page
history are not serialized. If every guest is protected, the safety contract
allows a temporary cap overage rather than discarding active user state.

The scenario requires both the DOM guest count and actual CDP `type=webview`
target count to converge to the cap, then proves a new WebContents and document
generation on restore. It records `memory.webview_guest_count`,
`memory.webview.total_rss_released_mb`,
`memory.webview.after_discard_rss_mb` (the absolute counterweight to released
RSS), and `memory.webview.restore_ready_ms`. Offscreen guest `requestAnimationFrame` can
be suspended by Chromium, so restore completion deliberately uses `dom-ready`
and synchronous scroll restoration instead of waiting on guest rAF. Missing
cap convergence, identity change, URL/scroll restoration, or timing evidence
fails the diagnostic rather than publishing a synthetic value.

The fixture and report schema are `perf-v2`; it has exact N/M/U normalization
and must not compare with `perf-v1` history. Existing `perf-v1` baseline
profiles and numbers remain unchanged. `renderer-trace` runs while the canvas
still has exactly N nodes; destructive `image-memory` (which adds ten image
nodes and reloads) runs afterward, and `ws-cycle` remains last. A renderer that
cannot produce a calm double-rAF interval within 30 seconds fails with the last
observed frame delta instead of silently starting a noisy measurement.
For exact M=0, the N-node reload no longer contains the welcome webpage. The
runner therefore saves only the initial pre-seed
`welcome:local-content-ready` mark and uses it as a narrow fallback for
`startup.welcome_local_content_ms`; every other startup renderer mark still
comes from the N-node reload. The startup report makes this explicit with
`welcomeLocalContentSource: "initial-pre-seed"` (or `"seeded-reload"` when the
post-seed fixture itself produces the mark).

This automatic N/M/U seeder is intentionally a **WebView-isolation regression
fixture**. Apart from the welcome nodes and requested webpage nodes, it fills
remaining capacity with text nodes; it does not reproduce the anonymized
86-node production mix's 19 Frames, files, images, mind maps, or running Agent.
Use it to compare guest/compositor behavior, not to claim that the complete
mixed user canvas has passed. A full workload conclusion requires a separate
mixed-type diagnostic run with its stored type counts recorded.

### CDP trace and Web Vitals diagnostics

The full report also captures `perf/out/renderer-trace.json.gz` plus
`renderer-trace-summary.json`. This uses the harness's existing Electron CDP
connection directly, so CI stays deterministic and does not depend on an MCP
server. The trace is a **warm renderer reload** after the normal 100-node
interaction scenarios, not a cold Electron process launch. The metric ids are
therefore namespaced under `startup.renderer_reload.*` and remain record-only.

LCP and CLS here are desktop Electron `file://` lab signals. They are useful
for detecting renderer loading and layout-stability regressions, but they are
not CrUX/field Core Web Vitals. The existing `interact.*.inp_p95_ms` values are
scenario-scoped Event Timing measurements rather than whole-page field INP.
The trace also separates shell-first-render blocking from Canvas→LCP blocking;
the former can be zero while a later Long Task still delays meaningful content.
Top-level TTFB, cache, render-blocking-network, and Speed Index metrics are not
included because a local `file://` Electron shell does not give them the same
product meaning as a hosted website. Remote webviews should be audited as
separate CDP targets when network behavior is the question.

Chrome DevTools MCP remains useful for interactive drill-down of a live trace,
but the upstream project officially supports Chrome/Chrome for Testing; an
Electron target is best-effort. When configured, connect it to the harness's
dynamic `cdpPort` with `--browser-url=http://127.0.0.1:<port>` rather than
starting an unrelated Chrome profile.

### Repeat / medians (A3)

`perf:report --repeat N` (default 3, min 1) drives two independent repeat
mechanisms so timing metrics stop being single-sample noise:

- **`report.mjs` boots the app N times** for the `startup` scenario — each of
  the first N-1 boots launches fresh, reads the `[perf] startup` phase log,
  and closes; only the Nth stays alive for the interactive scenarios below.
  Phases are folded into a same-machine median (`mergeStartupMedians`) with
  `runs`/`raw[]` recorded per program.md §3's schema.
- **`run-scenarios.mjs --repeat N`** re-drives
  `typing`/`resize`/`drag`/`zoom-cold`/`panzoom` N times against that one live session
  (cheap — no relaunch needed). It records the median and raw repeat samples
  for Event Timing, frame smoothness, the Pan/Zoom capture→rAF scheduling probe, and
  both cold-zoom latency fields (including transform-observation raw evidence);
  it also keeps the worst single-run frame percentage/count so a median `0%`
  cannot hide a real slow-frame sample. Deterministic counters take the max
  across runs as a safety net rather than noise smoothing.

`main.loop_delay_p99_ms` gets a smaller, incidental benefit: repeating
typing/resize/drag/zoom-cold/panzoom extends the session, giving the loop-delay sampler more 2s
windows to draw its percentile from. `main.loop_delay_max_ms` is not
repeat-stabilized — it's inherently a single worst-case reading, and the
dashboard's variance alert already suggests re-running to confirm outliers on
that metric specifically.

Call `pnpm --filter canvas-workspace perf:scenarios --repeat 3` directly
when driving a manually-started session (see below).

## Baseline policy

- `baselines.json → policies` is the only numeric SSOT. `target` is the desired
  product level, `warning` marks a material miss, and `gate` is an independent
  regression guard. A metric can therefore be “未达标” while its Gate still
  passes; only Gate failures make the command exit 1.
- `metrics.json` stores stable semantics (`direction`, `measurementProfile`,
  runtime counter source), never threshold numbers. Configuration validation
  fails closed when a `level:gate` metric has no executable policy Gate.
- Same-machine timing targets apply only when machine id, OS, architecture,
  node/webpage/URL-WebView counts, repeat count, fixture version, harness
  session profile, and actual headless mode
  match the named profile. A mismatch renders
  as “不适用”, not PASS or FAIL. Deterministic counters and build artifacts use
  the global profile.
- The 86-node / 40-webpage / 25-loopback-WebView fixture currently has no
  timing profile. Its cold presented-frame and scheduling values are
  record-only; its frame-smoothness policy is not applicable. It must not
  borrow the 100/0/0 profile's target or warning numbers.
- Counter Gates use `max`/`min`/`true`; bundle Gates use
  `baseline × (1 + tolerancePct/100)` ratchets. Lower the relevant target or
  Gate in the same PR when a fix creates durable headroom.
- Renderer trace targets remain diagnostic and do not gate CI. Promote one to
  a Gate only after at least five stable runs with the same Electron/Chromium,
  viewport, DPR, headless/GPU mode, machine, and measurement profile.

Reference numbers (2026-07-04, in-sandbox xvfb, temp profile):
startup whenReady→domReady 1598→2358 ms; typing@100 nodes INP p95 48 ms with
43% frames >20 ms; drag@100 nodes INP p95 ~130 ms. Counters: typing 120
replacements /120 keys, drag 91 /90 moves — the I-1/A2 amplifiers, measured.

Current resize result (2026-07-10, macOS headless, 100 nodes, 3 repeats):
per-run node-array replacements `[1,1,1]`, save IPCs `[2,1,1]`; gate maxima
`1` / `2`, and median frames over 20ms = 0%. Both counter gates pass against
their `10` / `3` limits.
