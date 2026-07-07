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

## Registration Sources & Config Paths

- Engine plugin disk scan (`scan !== false`): `.pulse-coder/engine-plugins`, `.coder/engine-plugins`, `~/.pulse-coder/engine-plugins`, `~/.coder/engine-plugins`, `./plugins/engine` — pattern `**/*.plugin.{js,ts}`.
- User-config plugins: `config.{json,yaml,yml}` / `*.config.{json,yaml,yml}` under `.pulse-coder/config`, `.coder/config` and home equivalents; supports `${VAR}` / `${VAR:-default}` env resolution; can declare tools, MCP servers, prompts, sub-agents, skills, env, conditions.
