# pulse-coder-langfuse-plugin

Langfuse observability engine plugin for Pulse Coder runtimes. Registers engine lifecycle hooks that record traces, LLM generations, tool spans, compaction events, and run metadata to a Langfuse instance, then flushes on shutdown.

The plugin is optional and auto-disables when credentials are missing, so it is safe to mount unconditionally.

## How it works

`createLangfusePlugin()` returns an `EnginePlugin` (from `pulse-coder-engine`). During `initialize` it constructs a `Langfuse` client, registers it as the `'langfuse'` service (other code can fetch it via `ctx.getService('langfuse')`), and registers the following hooks:

| Hook | Action |
|------|--------|
| `beforeRun` | Creates a trace keyed by `runId`. Trace `name` = `runContext.caller` or `'agent-run'`; `userId`/`sessionId` pulled from `runContext`; `input` = user text when `saveUserText` is on; `metadata` = `platformKey`, `channelKind`, `channelId`, `vaultId`, `callerSelectors`, `environment`; `tags` = static `tags` plus `platform:{platformKey}` and `caller:{caller}` when present. Stores per-run `RunState` in a `WeakMap<Context, RunState>`. |
| `beforeLLMCall` | Starts a `generation` (`name: 'llm-call'`), input = resolved system prompt plus current messages, `metadata.toolNames` = keys of the active tool set. |
| `afterLLMCall` | Ends the in-flight generation. Output = LLM text when `saveLLMOutput` is on; `usage`/`usageDetails` come from `normalizeUsage`; `metadata` = `finishReason` + `timings`. |
| `beforeToolCall` | Starts a `span` named `tool:{name}` with the tool input. Spans are tracked per tool name (last-wins; tools rarely nest). |
| `afterToolCall` | Ends the matching span with the tool output and removes it from the in-flight map. |
| `onCompacted` | Records a `context-compacted` event carrying the compaction `event` payload as metadata. |
| `afterRun` | Defensively ends any dangling generation/spans, sets the trace `output` to the run result, deletes the run state, and triggers a fire-and-forget `flushAsync()`. The flush is deliberately **not** awaited — awaiting would block the engine loop (which runs on GUI main threads). |
| `destroy` | Calls `lf.shutdownAsync()` to flush any batched events on shutdown. |

### Run ID resolution

`runId` is read from `runContext.runId` if present; otherwise a `randomUUID()` is generated and written back into `runContext.runId` so downstream code sees the same id. Per-run state is held in a `WeakMap<Context, RunState>` and cleared in `afterRun`, so spans do not leak across runs.

### Usage normalization

`normalizeUsage()` accepts both token shapes produced by the engine:

- **AI SDK Anthropic** (`ai-sdk` >= 4.x): `inputTokens`/`outputTokens` are objects (`{ total, noCache, cacheRead, cacheWrite }` / `{ total, text, reasoning }`).
- **OpenAI-compatible**: `promptTokens`/`completionTokens`/`totalTokens` as plain numbers.

Cache read/write tokens are preserved in `usageDetails` (`cache_read` / `cache_write`) and surface as a token breakdown in the Langfuse UI.

## Install

This is a workspace package — add it as a workspace dependency (pnpm only; never npm/yarn):

```json
{
  "dependencies": {
    "pulse-coder-langfuse-plugin": "workspace:*"
  }
}
```

## Configuration

Options are passed to `createLangfusePlugin()`. Every credential/URL option also has an environment fallback resolved at factory call time.

| Option | Env var | Default | Description |
|--------|---------|---------|-------------|
| `publicKey` | `LANGFUSE_PUBLIC_KEY` | — | Langfuse public key. Required to activate. |
| `secretKey` | `LANGFUSE_SECRET_KEY` | — | Langfuse secret key. Required to activate. |
| `baseUrl` | `LANGFUSE_HOST` (then `LANGFUSE_BASEURL`) | Langfuse Cloud | Langfuse host URL (self-hosted instances). |
| `release` | `LANGFUSE_RELEASE` | — | Release tag (e.g. git sha) attached to every trace. |
| `environment` | `NODE_ENV` | `NODE_ENV` | Environment tag on every trace. |
| `tags` | — | `[]` | Extra static tags appended to every trace. |
| `pluginName` | — | `'langfuse'` | Plugin name shown in the `PluginManager`. |
| `pluginVersion` | — | `'0.1.0'` | Plugin version. |
| `disabled` | — | auto-disable when `publicKey`/`secretKey` missing | Force-disable the plugin (useful in dev). |
| `saveUserText` | — | `true` | Include user input text as trace `input`. Set `false` for PII-sensitive deployments. |
| `saveLLMOutput` | — | `true` | Include full LLM output text on the generation. Set `false` for PII-sensitive deployments. |

When `disabled` resolves to true, `initialize` logs a warning and registers nothing — no `Langfuse` client is created and no hooks fire.

## Usage

The factory returns an `EnginePlugin`; pass it to the engine's plugin list.

```typescript
import { Engine } from 'pulse-coder-engine';
import { createLangfusePlugin } from 'pulse-coder-langfuse-plugin';

const langfusePlugin = createLangfusePlugin({
  tags: ['my-host'],
  // publicKey/secretKey/baseUrl omitted -> read from env
});

const engine = new Engine({
  enginePlugins: {
    plugins: [langfusePlugin],
  },
});
```

With credentials in the environment:

```bash
export LANGFUSE_PUBLIC_KEY=pk-lf-...
export LANGFUSE_SECRET_KEY=sk-lf-...
export LANGFUSE_HOST=https://cloud.langfuse.com   # optional; self-host otherwise
export LANGFUSE_RELEASE=$(git rev-parse --short HEAD)  # optional
```

The in-repo consumer is `apps/remote-server`, which mounts the plugin with a host tag:

```typescript
// apps/remote-server/src/core/langfuse.ts
import { createLangfusePlugin } from 'pulse-coder-langfuse-plugin';

export const langfusePlugin = createLangfusePlugin({
  tags: ['remote-server'],
});
```

That plugin is then added to the engine's `plugins` array in `apps/remote-server/src/core/engine-singleton.ts`.

### Exports

| Export | Kind | Description |
|--------|------|-------------|
| `createLangfusePlugin` | named function | Factory returning an `EnginePlugin`. |
| `default` | default export | Alias of `createLangfusePlugin`. |
| `LangfusePluginOptions` | interface | Options type for the factory. |

The package ships ESM and CJS builds (`dist/index.js`, `dist/index.cjs`) plus type declarations (`dist/index.d.ts`). A `./src` subpath is also exported for direct source imports.

## Privacy

`saveUserText` and `saveLLMOutput` both default to `true`, so trace inputs and LLM outputs are recorded by default. For deployments handling PII, pass `saveUserText: false` and/or `saveLLMOutput: false` to redact those fields while still capturing spans, events, usage, and metadata. Do not hardcode credentials — use the env vars or pass them via options at runtime.

## Build & Test

```bash
pnpm --filter pulse-coder-langfuse-plugin build
```

Build uses `tsup` (ESM + CJS, DTS unless `SKIP_DTS=1`). `langfuse` and `pulse-coder-engine` are marked `external` in `tsup.config.ts`.

Honest gaps (per repo `AGENTS.md`):

- `test` (`vitest run`) has **no test files** and exits non-zero — there is no `--passWithNoTests`. Do not treat a green `test` as coverage.
- `typecheck` (`tsc --noEmit`) currently hits TS6059 because the package imports workspace source from `packages/engine` outside its `rootDir`. Prefer `build` as the smoke check. `harness/validation.yaml` lists `build` as the required check for this path.
- There is no CI, no git hooks, and no executable harness checks — these commands must be run by hand.

## Relationship to neighbors

- **`packages/engine`** — defines the `EnginePlugin` interface, `EnginePluginContext` (`registerHook`, `registerService`, `logger`, …), and the hook input shapes (`BeforeRunInput`, `AfterLLMCallInput`, `OnCompactedInput`, etc.) this plugin consumes. Engine hook contracts live there; this package only registers handlers.
- **`apps/remote-server`** — the in-repo host that mounts this plugin. Treats it as an optional observability plugin: policy (which fields to save, which tags to attach) belongs to the host, not this package.
- **`harness/profile.yaml` / `harness/validation.yaml`** — workspace routing and the path-to-check mapping (`build` is the required check for `packages/langfuse-plugin/**`).
