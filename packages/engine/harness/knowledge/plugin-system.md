# Engine Plugin System

How to author, register, and reason about `EnginePlugin`s. Facts verified against source; line refs are approximate anchors, trust the symbol names.

## Plugin Contract

`EnginePlugin` (`src/plugin/EnginePlugin.ts`): required `name`, `version`, `initialize(ctx)`; optional `dependencies?: string[]`, `beforeInitialize?`, `afterInitialize?`, `destroy?`.

`EnginePluginContext` gives a plugin: `registerTool`/`registerTools`, `getTool`/`getTools`, `registerHook`, `registerService`/`getService`, `getConfig`/`setConfig`, `getEngineInstance()`, `events` (EventEmitter), `logger`.

## Hook Map

| Hook | Fires | Can mutate |
|---|---|---|
| `beforeRun` | once at `Engine.run()` start | systemPrompt, tools |
| `beforeLLMCall` | before every LLM call, retries included | systemPrompt, tools |
| `beforeToolCall` | before each tool execution (inside the wrapped tool) | input; throw to abort |
| `onToolCall` | when the LLM emits a tool-call chunk (fire-and-forget) | — |
| `afterToolCall` | after each tool execution | output |
| `onCompacted` | after compaction produced a new message list (best-effort) | — |
| `afterLLMCall` | after every LLM call, including the error path | — |
| `afterRun` | once after the loop exits | — |

Hook handlers are wrapped with timing instrumentation (`hookTiming` events, `PluginManager`). `beforeToolCall`/`afterToolCall` observe read/ls output with the dedup note already appended (see `architecture.md` Runtime Invariants).

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

External example: `packages/memory-plugin` wraps its service in a factory returning `{ name, version, initialize }`.

Pitfalls (all evidenced):
- Misspelled dependency name: silent at sort, hard throw at init — and only in loading combinations that omit the intended plugin.
- `registerService` and tool registration overwrite silently on name collision; later registration wins (`Engine.ts` tool merge: built-ins < plugin tools < `options.tools`).
- `beforeRun`/`beforeLLMCall` results merge only the keys you return; returning `void`/`{}` is safe and does nothing.

## Plugin Facts Worth Knowing

- **Construction is fail-fast**: `PluginManager.initialize` rethrows and `Engine.ts` has no try/catch around it, so ANY single plugin's init failure aborts the entire Engine build — one bad plugin means MCP/skills/plan-mode that would have loaded fine never do. Common cause: a misspelled `dependencies` entry (throws `Dependency not found` at init).
- **MCP registers statically at init only**: config changes need a full Engine rebuild (the `closeAll()`/reload path is a code comment, not an implementation); OAuth applies to `http`/`sse` transports only, never `stdio`; a `disabledTools` entry is still listed in `status.tools` with `enabled:false`.
- **Skills precedence**: project before user, `.pulse-coder` before other roots; dedup is realpath-based then case-insensitive-name with FIRST-scanned winning. Skills support `rescan()` hot-reload; sub-agents do NOT, and sub-agents only scan `.pulse-coder/agents`/`.coder/agents` (no home-dir location, unlike skills/MCP).
- **Sub-agent frontmatter is regex-parsed, not YAML**: `.md` agent configs use a hand-rolled `key: value` line matcher — quotes, multi-line, and nested YAML constructs silently mis-parse; `deferLoading` must be the literal string `'true'`/`'false'`.

## The Tools Pipeline (keystone)

During each LLM call the loop threads ONE mutable `tools` object through every `beforeLLMCall` hook in plugin registration order (`core/loop.ts`): `tools = result.tools` reassigns it per hook, so each plugin sees only what earlier plugins left and can add, remove, or hide entries. It is a pipeline, not a merge. The built-in order (`built-in/index.ts`) is: MCP → Skills → ToolSearch → PlanMode → TaskTracking → SubAgent → AgentTeams → RoleSoul → PTC.

This one mechanism explains most "gating weaker than its name" behavior:

| Stage | What it does to `tools` |
|---|---|
| ToolSearch | Visibility gate: hides every `defer_loading` tool (MCP, Tavily, sub-agent, generate_image, role-soul `soul_*` ×7, `agent_teams_run`) until a `tool_search_*` call loads them on the NEXT LLM call. `PULSE_CODER_TOOL_SEARCH_VARIANT` is inert — both bm25 and regex tools are always registered regardless. |
| PlanMode | Removes only `write`/`edit` in planning mode (`DISALLOWED_TOOLS_IN_PLANNING`); `bash`, MCP, and sub-agent tools stay callable. It never auto-enters planning (only `Engine.setMode('planning')` does), and policy violations are passive logs, never throws. |
| PTC | Caller-allowlist filter. It UNIONS the typed `Tool.allowed_callers` with the untyped `tool.ptc.allowed_callers` convention, so declaring both BROADENS access, not narrows it. Registered last, so it only sees what every earlier stage left. |

Because it is sequential, a tool a downstream plugin relies on may already be gone; nothing re-checks what a later stage removed.

## Registration Sources & Config Paths

- Engine plugin disk scan (`scan !== false`): `.pulse-coder/engine-plugins`, `.coder/engine-plugins`, `~/.pulse-coder/engine-plugins`, `~/.coder/engine-plugins`, `./plugins/engine` — pattern `**/*.plugin.{js,ts}`.
- User-config plugins: `config.{json,yaml,yml}` / `*.config.{json,yaml,yml}` under `.pulse-coder/config`, `.coder/config` and home equivalents. HONEST STATUS: the schema admits tools/MCP servers/prompts/sub-agents/skills, and files are scanned and validated — but `applyUserConfig` (`PluginManager.ts`) is an unimplemented stub that only logs each entry; nothing is instantiated or registered. The `${VAR}` resolver is also constructed without `process.env`, so substitutions never see real env values. Treat declarative user-config as NOT functional today.
