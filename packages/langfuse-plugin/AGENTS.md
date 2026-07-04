# AGENTS.md - packages/langfuse-plugin

> Local entry for `packages/langfuse-plugin`.
> Repository harness entry: `../../harness/README.md`.

## Module Positioning

`pulse-coder-langfuse-plugin` owns Langfuse observability integration for Pulse Coder engine runtimes. It creates an engine plugin that registers lifecycle hooks for traces, LLM generations, tool spans, compaction events, run metadata, and shutdown flushing.

This package should remain an optional observability plugin. Core engine hook contracts belong in `packages/engine`; host-specific telemetry policy belongs in the host that configures this plugin.

## Knowledge Navigation

| Task | Read |
|---|---|
| Package scripts and exports | `package.json` |
| Plugin factory and options | `src/index.ts` |
| Build/typecheck shape | `tsup.config.ts`, `tsconfig.json` |
| Engine plugin contracts | `../engine/AGENTS.md`, `../engine/src/plugin/` |
| Engine runtime hooks | `../engine/src/core/loop.ts` |
| Validation matrix | `../../harness/validate/validation.yaml` |

This package currently has no local `README.md`, `docs/`, or test files; use `src/index.ts` as the package-local source of truth until those exist.

## Local Constraints

- Keep the plugin optional and safe to disable when Langfuse keys are absent.
- Do not commit or hardcode Langfuse credentials; use `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_HOST`/`LANGFUSE_BASEURL`, and related environment-driven options.
- Be deliberate about trace payload privacy. `saveUserText` and `saveLLMOutput` default to enabled, so host deployments may need to override them.
- Do not block the engine loop on trace flushing during normal runs; preserve fire-and-forget behavior unless changing the contract intentionally.
- `disabled` defaults to true when keys are missing. Keep that dev-safe behavior.
- Run IDs are shared through `runContext.runId` and `WeakMap<Context, RunState>`; keep cleanup in `afterRun`/`destroy` defensive so spans do not leak across runs.
- Usage normalization currently handles AI SDK Anthropic cache token shapes and OpenAI-compatible token numbers; preserve cache read/write details.
- Changes to hook usage, exported options, metadata shape, trace fields, or service registration are contract changes; use local validation plus the root impact overlay.

## Common Commands

```bash
pnpm --filter pulse-coder-langfuse-plugin build
```

`test` currently has no test files and exits non-zero. `typecheck` currently hits TS6059 because the package imports workspace source from `packages/engine` outside this package's `rootDir`; prefer `build` until that TypeScript boundary is fixed. Harness validation also lists `build` as the required check.

## Key Files

- `src/index.ts`: `createLangfusePlugin`, option resolution, hook registration, usage normalization, trace/span lifecycle, and default export.
- `package.json`: package exports, build scripts, and Langfuse/engine dependencies.
- `tsup.config.ts`: build output configuration.
- `tsconfig.json`: current package TypeScript boundary.
