# Engine Harness Gap Analysis vs pi

Date: 2026-08-02
Method: full-source inventory of `packages/engine` (all 10 harness/knowledge
docs + source verification) compared against pi (earendil-works/pi, ex
badlogic/pi-mono, ~62k stars) via its package documentation.
Companion to `06-harness-engineering-roadmap.md` and the focus plan
(`canvas-workspace-product/focus-convergence-plan.md`).

## Verdict

The intuition "engine 的 agent harness 不完整" is correct, and the gap is
NOT feature count — engine ships more features than pi (MCP, memory,
langfuse, orchestrator, PTC, plan-mode, tasks, skills hot-rescan). The gap
is **infrastructure completeness**: pi makes a small set of things
closed-loop, contractual, and measurable; engine makes many things
work-in-the-happy-path, documented-in-prose, and host-dependent. Pi's
motto is aggressive minimalism with complete plumbing; engine today is
broad capability with incomplete plumbing.

## Dimension comparison

| Dimension | engine (today) | pi (2026) |
|---|---|---|
| Sessions | NOT an engine concept — `Context = { messages }`; no persistence/resume/branch; every host reinvents (canvas: 636-line session-store with its own `branchSession`; cli: `SessionManager`; remote-server: per-call) | Tree-structured JSONL sessions, in-file branching, `/tree` navigation, `/fork`, `/clone`, `--fork`, auto-save by cwd, resume by id/path, SQLite adapter package |
| Compaction | Exists (char/4 estimate, LLM summary → hard-truncate fallback, 2-attempt budget) but **loop never writes back `context.messages`** — host must wire `onCompacted` or compaction silently doesn't apply; algorithm has ZERO tests; hardcoded Chinese template | Auto (overflow detection + proactive limits) + manual `/compact [prompt]`; tree keeps full history so compaction is lossy only for active context |
| Host protocol | Library API + 8 hooks + callbacks; no typed event stream; no RPC/JSON mode; canvas consumes via a hand-written loose `engine.d.ts` shim; only agent-teams typechecks against dist | Typed event model (`agent/turn/message/tool_execution` × `start/update/end`); print/JSON (LDJSON), RPC (stdin/stdout JSONL), SDK (`createAgentSession`, `ModelRuntime`); separate CBOR protocol package (v2) with "snapshots authoritative / progress events transient" semantics |
| Turn control | `AbortSignal` only — abort is the single mid-run intervention | `steer()` (interrupt during tool execution), `followUp()` queue, `waitForIdle()`, abort |
| Quality machinery | 11 test files; zero specs for orchestrator (695 LOC), compaction, ai/, config/, prompt/, and tools read/write/edit/ls/bash/tavily/clarify; no vitest config or coverage gates; no evals | Dedicated `evals` package: vitest-evals judges (deterministic + model-backed), pass-rate-lift comparisons between configs, `.eval/runs.jsonl` indexing, CI-friendly soft assertions |
| Providers | 2 SDK adapters (openai `.responses`, anthropic) + injectable factory; env-only auth; unconditional Anthropic `cacheControl` (no breakpoint logic, no cache accounting); NO Anthropic extended thinking (`OPENAI_REASONING_EFFORT` only); no fallback chain | 15+ providers; API keys AND subscription auth (Claude Pro/Max, ChatGPT Plus/Pro, Copilot); llama.cpp local; custom via `models.json`; `getApiKey` dynamic resolution; `thinkingLevel` off→max first-class with per-level budgets |
| Tools | 13 built-ins (broader: tavily×4, generate_image, clarify) but `edit` is naive exact-match with **sync I/O** (violates the package's own no-blocking-I/O invariant); prompt references a `glob` tool that doesn't exist; no web-fetch; flat `ls` | 4 core (read/write/edit/bash) + discoverable grep/find/ls; `--tools/--exclude-tools`; extensions can replace built-ins |
| Extensibility | Rich: 8 hooks, services, config, disk scan + topo sort — comparable to pi; but user-config plugins are an inert stub, plugin init is fail-fast (one bad plugin kills the engine), and disk plugins auto-`import()` with no trust gate | TS extensions (tools/commands/event hooks/UI); heavy features (sub-agents, MCP, permission gates, checkpointing) ARE extensions; `pi install npm:/git:` package distribution; project trust model (`trust.json`, prompt before loading local extensions) |
| Sub-agents | Regex-parsed frontmatter (not YAML), full parent toolset (no per-agent restriction), progress to stdout with ANSI | Deliberately omitted from core; extension/tmux patterns documented |
| MCP | Real: 3 transports, OAuth factory, namespacing, manager service with working `closeAll()` | Deliberately omitted; "build CLI tools with READMEs, or an extension" |
| Safety posture | Zero containment, undeclared: `beforeToolCall` short-circuit is the only boundary; plan-mode declared-vs-enforced gap (removes only write/edit; bash stays); orphaned `pulse-sandbox` package; disk plugin auto-import ungated | Also zero permission system, but LOUDLY declared, with containerization patterns (micro-VM/Docker) documented and a trust gate on local config/extensions |
| Host leakage in core | `formatUpstreamError` bakes Chinese remote-server copy into loop.ts; `Platform: darwin` hardcoded in system prompt; `GPT_EXPLORATION_CONSTRAINT` appended for non-claude | Core is host-clean; TUI/server/client are separate packages |
| Observability | `hookTiming` events, `afterLLMCall` usage + 4 timing marks; langfuse plugin in plugin-kit (incl. cache-token breakdown); but no token/cost accounting in engine and console.* logging | Telemetry on eval runs (tokens/latency/cost); settings-controlled telemetry |

## The five structural holes (ranked)

1. **Sessions are not an engine concept.** The single biggest gap. Every
   host reimplements persistence/resume; branching exists only inside
   canvas's private store. Pi proves tree-sessions + storage adapters
   belong in the harness. This also blocks the north-star demo's
   "reopen and resume" step from ever being engine-guaranteed.
2. **The compaction loop is broken-by-contract and untested.**
   `loop.ts` never reassigns `context.messages` after compaction — a host
   that doesn't wire `onCompacted` burns both attempts and still sends
   the uncompacted history (host-integration.md claims otherwise — doc
   drift). The algorithm itself (`src/context/index.ts`) has no tests.
3. **No typed event/e mbedding protocol.** Hooks + callbacks force each
   host to assemble its own integration; canvas's hand-written
   `engine.d.ts` shim is the loudest alarm. Pi's event stream + modes +
   protocol package (with authoritative-snapshot semantics) is the
   pattern: hosts consume events, not internals.
4. **No mid-run steering.** Abort is the only intervention; canvas's
   chat-stop machinery compensates at the host layer. `steer`/`followUp`
   queues are loop-level features.
5. **Harness quality is not measured.** No evals, no coverage gates,
   orchestrator/compaction/most tools untested, and this inventory found
   7 doc-drift items in harness/knowledge (tool-offload plugin entirely
   undocumented; compaction write-back claim; MCP closeAll/defer claims;
   PTC gate semantics; edit.ts blocking I/O; barrel omissions count).
   Pi measures harness behavior with model-backed judges in CI.

## What engine has that pi omits — keep it

MCP (canvas needs it), memory + langfuse (plugin-kit), skills hot-rescan
(10 roots, Claude/Codex-compatible — arguably ahead of pi), orchestrator/
agent-teams (frozen per focus plan), PTC, plan-mode, task tracking. Per
the focus plan's layering: these stay; the investment shifts to the
plumbing underneath them. Do not cargo-cult pi's minimalism — copy its
completeness.

## Recommended engine track (feeds the focus plan)

- **P0a — fix the compaction write-back defect** and give
  `src/context/index.ts` a real test suite (small, fatal, cheap).
- **P0b — design session primitives**: a `SessionStore` interface +
  tree/branch message model in the engine, storage adapters per host;
  migrate canvas's session-store to be the reference adapter. This is
  general mechanism (no canvas concepts), consistent with the
  general-purpose-engine decision.
- **P1 — typed AgentEvent stream** layered over the existing hooks
  (message/tool/turn lifecycle events), consumed by canvas directly;
  kills the `engine.d.ts` shim. Then `steer`/`followUp` queues.
- **P2 — evals package** (vitest-evals pattern; first targets: loop
  finish-reason dispatch, compaction behavior, edit-tool success rate);
  provider layer (Anthropic extended thinking, token/cost accounting,
  auth beyond env); async + tolerant `edit`; declare the trust/containment
  posture (resolve the `spec/` gating entry).
- **Hygiene from this pass**: write the 7 doc-drift corrections back into
  `harness/knowledge/`; remove or implement the inert `applyUserConfig`;
  delete the phantom `glob` reference from the system prompt (or add the
  tool); un-hardcode `Platform: darwin` and the Chinese remote-server
  error copy (host-agnostic rule).

## Sources

- Engine: full-source inventory pass, 2026-08-02 (all
  `packages/engine/harness/knowledge/*.md`, `harness/spec/*`, and source
  verification; file:line evidence recorded in the inventory).
- Pi: package READMEs of earendil-works/pi (coding-agent, agent, evals,
  protocol) fetched 2026-08-02; press coverage for status/positioning.
