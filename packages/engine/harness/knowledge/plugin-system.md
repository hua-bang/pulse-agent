# Engine Plugin System

How to author, register, and reason about `EnginePlugin`s. Facts verified against source; line refs are approximate anchors, trust the symbol names.

## Plugin Contract

`EnginePlugin` (`src/plugin/EnginePlugin.ts`): required `name`, `version`, `initialize(ctx)`; optional `dependencies?: string[]`, `beforeInitialize?`, `afterInitialize?`, `destroy?`.

`EnginePluginContext` gives a plugin: `registerTool`/`registerTools`, `getTool`/`getTools`, `registerHook`, `registerService`/`getService`, `getConfig`/`setConfig`, `getEngineInstance()`, `events` (EventEmitter), `logger`.

## Hook Map

| Hook | Fires | Can mutate |
|---|---|---|
| `beforeRun` | once at `Engine.run()` start | systemPrompt, tools |
| `beforeLLMCall` | before every LLM call, retries included | policy: systemPrompt, tools |
| `prepareToolPresentation` | after all beforeLLMCall policy hooks | model prompt, descriptions, tool subset; preserves policy execution |
| `beforeToolCall` | before each tool execution (inside the wrapped tool) | input; throw to abort |
| `onToolCall` | when the LLM emits a tool-call chunk (fire-and-forget) | — |
| `afterToolCall` | after each tool execution | output |
| `onCompacted` | after compaction produced a new message list (best-effort) | — |
| `afterLLMCall` | after every LLM call, including the error path | — |
| `afterRun` | once after the loop exits | — |

Hook handlers are wrapped with timing instrumentation (`hookTiming` events, `PluginManager`). Each engine plugin's initialization emits `pluginInitTiming` (`pluginName`, `startedAt`, `durationMs`, `ok`), and the MCP built-in emits `mcpServerTiming` (`McpServerTiming`) per configured server; both are best-effort diagnostics on `engine.events`. `beforeToolCall`/`afterToolCall` observe read/ls output with the dedup note already appended (see `architecture.md` Runtime Invariants).

## Lifecycle

1. Registration sources, in order: built-in array (`src/built-in/index.ts`, skipped entirely by `disableBuiltInPlugins`) → `options.plugins[]` → disk scan → user-config plugins (loaded after engine plugins, no dependency sorting).
2. Dependency topological sort. Circular dependency THROWS at sort; a dependency missing from the list is skipped at sort but THROWS `Dependency not found` at init (see `architecture.md` Runtime Invariants).
3. Per plugin: `beforeInitialize?` → `initialize` → `afterInitialize?`.

## Authoring Walkthrough

Real shape (condensed from `built-in/task-tracking-plugin/index.ts`):

```ts
export const myPlugin: EnginePlugin = {
  name: 'my-plugin',
  version: '1.0.0',
  dependencies: ['pulse-coder-engine/built-in-skills'],
  async initialize(ctx) {
    const service = new MyService();
    ctx.registerService('myService', service);       // string-keyed, silent overwrite
    ctx.registerTools({ my_tool: buildMyTool(service) });
    ctx.registerHook('beforeRun', async () => { /* inject prompt/tools */ });
  },
};
```

External example: plugin-kit's memory module (`packages/plugin-kit/src/memory`) wraps its service in a factory returning `{ name, version, initialize }`.

Pitfalls (all evidenced):
- Misspelled dependency name: silent at sort, hard throw at init — and only in loading combinations that omit the intended plugin.
- `registerService` and tool registration overwrite silently on name collision; later registration wins (`Engine.ts` tool merge: built-ins < plugin tools < `options.tools`).
- `beforeRun`/`beforeLLMCall` results merge only the keys you return; returning `void`/`{}` is safe and does nothing.

## Plugin Facts Worth Knowing

- **Construction is fail-fast**: `PluginManager.initialize` rethrows and `Engine.ts` has no try/catch around it, so ANY single plugin's init failure aborts the entire Engine build — one bad plugin means MCP/skills/plan-mode that would have loaded fine never do. Common cause: a misspelled `dependencies` entry (throws `Dependency not found` at init).
- **MCP registers statically at init only**: config changes need a full Engine rebuild (the `closeAll()`/reload path is a code comment, not an implementation); OAuth applies to `http`/`sse` transports only, never `stdio`; a `disabledTools` entry is still listed in `status.tools` with `enabled:false`. Servers start in parallel (each bounded by `startupTimeoutMs`, default 30s, per-server override); tools register afterwards in config order so the model-visible tool list does not depend on completion order. MCP server/tool punctuation is normalized to `[a-zA-Z0-9_-]` at registration because model providers can reject the wider MCP naming surface.
- **MCP App icons are best effort**: `@ai-sdk/mcp` `tools()` drops the MCP `icons` field and the client does not keep `serverInfo`. For servers that declare app entrypoints, startup re-reads `tools/list` through the client's runtime `listTools()` (not on the public type) and attaches shape-checked `data:`/`https:` icons to `MCPAppToolDescriptor.icons`. The read starts after `tools()` but outside the startup timeout; registration waits at most 2 s for it, and any failure or timeout leaves `icons` unset without failing the server. Server-level icons are not available. Hosts own fetching and content checks. Guard: `mcp-plugin/index.test.ts`.
- **Skills precedence**: project before user, `.pulse-coder` before other roots; dedup is realpath-based then case-insensitive-name with FIRST-scanned winning. Skills support `rescan()` hot-reload; sub-agents do NOT, and sub-agents only scan `.pulse-coder/agents`/`.coder/agents` (no home-dir location, unlike skills/MCP).
- **Startup file scanning is async**: Skills and Role Soul discovery use async glob/realpath/read operations. These plugins initialize inside hosts such as Electron's GUI main process, so reintroducing any `*Sync` filesystem/glob API blocks unrelated IPC and is guarded by `src/built-in/nonblocking-scan.test.ts`; ordered awaits preserve source precedence and deterministic first/last-wins behavior.
- **Sub-agent frontmatter is regex-parsed, not YAML**: `.md` agent configs use a hand-rolled `key: value` line matcher — quotes, multi-line, and nested YAML constructs silently mis-parse; `deferLoading` must be the literal string `'true'`/`'false'`.

## The Tools Pipeline (keystone)

During each LLM call the loop threads ONE mutable `tools` object through every `beforeLLMCall` hook in plugin registration order (`core/loop.ts`): `tools = result.tools` reassigns it per hook, so each plugin sees only what earlier plugins left and can add, remove, or hide entries. It is a pipeline, not a merge. ToolSearch filters only in the subsequent `prepareToolPresentation` phase, which cannot restore policy-denied tools or replace their execution wrappers. The built-in registration order (`built-in/index.ts`) is: MCP → Skills → ToolSearch → PlanMode → TaskTracking → SubAgent → AgentTeams → RoleSoul → PTC.

This one mechanism explains most "gating weaker than its name" behavior:

| Stage | What it does to `tools` |
|---|---|
| ToolSearch | Threshold gate (Claude Code `ENABLE_TOOL_SEARCH=auto` semantics): serializes every `defer_loading` tool (MCP, Tavily, sub-agent, generate_image, role-soul `soul_*` ×7, `agent_teams_run`) and if the total is below `PULSE_CODER_TOOL_SEARCH_THRESHOLD`% of `CONTEXT_WINDOW_TOKENS` (default 10) loads ALL tools upfront — no search tools exposed, tools list stays constant for prompt-cache stability. At/above the threshold it defers: `tool_search_tool_bm25`/`tool_search_tool_regex` are exposed, a search call loads tools into the top level on the NEXT LLM call, and the plugin no longer appends a `Tool search loaded` system message (would defeat caching). `_THRESHOLD=0` forces defer+search always. |
| PlanMode | Hard gate in planning mode: `beforeToolCall` short-circuits any tool classified `write`/`execute` (incl. `generate_image`) with a synthetic rejection; `bash` additionally runs a read-only command classifier (`readonly-command.ts`) so only the built-in read-only set runs. Tools are NOT removed from the top-level list (stays stable); MCP/sub-agent/indirect calls pass through the same boundary. Never auto-enters planning (only `Engine.setMode('planning')` does). |
| PTC | Caller-allowlist filter. It UNIONS the typed `Tool.allowed_callers` with the untyped `tool.ptc.allowed_callers` convention, so declaring both BROADENS access, not narrows it. Registered last, so it only sees what every earlier stage left. |

Because it is sequential, a tool a downstream plugin relies on may already be gone; nothing re-checks what a later stage removed.

## Opt-in Codemode

`createCodemodePlugin` is exported from both public barrels but is not in
`builtInPlugins`. Hosts install it explicitly. Enabled MCP tools are eligible
by default; optional `allowedTools` adds reviewed ordinary tools. It registers the `codemode` tool with `{ code: string }`
input. The plugin owns its worker, QuickJS/WASM VM, JSON bridge, serial queue,
resource limits and cancellation; it does not use a Pi runtime package.

```ts
createCodemodePlugin({ allowedTools: ['read', 'grep', 'ls'] })
```

Scripts use `tools[name](args)`, `ALL_TOOLS`, `describeTools(names)`, `text(value)`
and return. Both discovery APIs include a `callExpression`, for example
`tools["canvas_read_context"]`, alongside the tool name. Tool functions are not
bare globals; punctuated MCP names require bracket notation. A bare known tool
name produces a ReferenceError with the correct invocation hint, without executing
or retrying a tool. Discovery returns JSON schemas, not TypeScript source. Each script
gets a fresh VM; no Node, network, filesystem or cross-script storage globals
are injected. Tool names retain their original spelling. Even Promise.all calls
execute serially. No tool retries are performed.

The authorized catalog uses the current policy table after `beforeLLMCall`,
before `prepareToolPresentation` defers model declarations. Enabled MCP tools
carry `codemode: true`, except MCP App tools, which carry `false`; ordinary tools require `allowedTools` or an explicit
true marker. `codemode: false` overrides both. Tool names never infer provenance.
Caller rules remain enforced even without PTC. Deferred eligible tools can be
called without first searching; policy-removed tools cannot. Presentation hooks
cannot restore names or replace policy execution wrappers. Both native loop and external
ToolSession provide the same `ToolExecutionContext.nestedTools` capability.
Nested execution validates input (including MCP JSON schemas with the compact
schemasafe compiler), runs tool hooks,
and preserves run authority without emitting model lifecycle hooks or adding
intermediate results to model history. Hook-generated synthetic results are
recorded as `intercepted`, rather than claiming the underlying tool ran.

`resultTarget: 'script'` preserves policy-processed output for the VM; the
offload plugin captures MCP results but skips model-only stub replacement for
that target. Final Codemode results still pass through ordinary offload. Existing
tool-internal truncation remains effective.

Results include `ok`, explicit `output`, optional `value` / `error`, and bounded
`calls` metadata. Oversized `text()` output becomes a head/tail preview with an
explicit marker and `outputTruncated: true`; printing a large successful drawing
result does not fail the script or replay its completed tool calls. The trusted
worker bounds text before transport. The host gives a valid JSON return value
priority over text in the shared budget and clips the preview further if needed.
A return value that alone exceeds the budget remains an error; JSON is never
partially parsed or silently changed. Preview slicing preserves surrogate pairs. `codemodeTool` engine events carry child IDs, parent IDs, names,
states and elapsed times without raw results. This does not provide host UI
integration or durable recovery. Stopping cancels pending/active calls and
terminates the worker; host tools must honor AbortSignal to stop their own I/O.

Limits: source 64 KiB UTF-8, wall clock 60 seconds (including tools), heap 64 MiB,
100 tool calls, arguments 64 KiB (checked before worker transport), queued
arguments 1 MiB, each result 2 MiB, cumulative results 16 MiB,
and explicit output plus return 30,000 characters (including preview markers). Hosts may set positive
`timeoutMs` / `memoryLimitBytes`. `runtimeModulePath` lets bundled hosts supply
an absolute quickjs-emscripten-core entry, and `wasmVariantModulePath` selects
the release-sync variant entry. `wasmLoaderModulePath` supplies its CommonJS
Emscripten loader. Only that WASM variant is a runtime dependency;
debug and asyncify variants are not shipped. The trusted worker bootstrap ships inside
the engine bundle, while the dependency resolves its own WASM resources.
Installed Electron compatibility remains a host acceptance requirement.

## Registration Sources & Config Paths

- Engine plugin disk scan (`scan !== false`): `.pulse-coder/engine-plugins`, `.coder/engine-plugins`, `~/.pulse-coder/engine-plugins`, `~/.coder/engine-plugins`, `./plugins/engine` — pattern `**/*.plugin.{js,ts}`.
- User-config plugins: `config.{json,yaml,yml}` / `*.config.{json,yaml,yml}` under `.pulse-coder/config`, `.coder/config` and home equivalents. HONEST STATUS: the schema admits tools/MCP servers/prompts/sub-agents/skills, and files are scanned and validated — but `applyUserConfig` (`PluginManager.ts`) is an unimplemented stub that only logs each entry; nothing is instantiated or registered. The `${VAR}` resolver is also constructed without `process.env`, so substitutions never see real env values. Treat declarative user-config as NOT functional today.
