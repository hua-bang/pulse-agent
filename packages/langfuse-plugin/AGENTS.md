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
| Engine plugin contracts | `../engine/AGENTS.md`, `../engine/src/plugin/` |
| Engine runtime hooks | `../engine/src/core/loop.ts` |
| Documentation routing | `../../harness/skills/doc-governance.md` |
| Validation planning | `../../harness/skills/quality-workflow.md` |

## Local Constraints

- Keep the plugin optional and safe to disable when Langfuse keys are absent.
- Do not commit or hardcode Langfuse credentials; use `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_HOST`/`LANGFUSE_BASEURL`, and related environment-driven options.
- Be deliberate about trace payload privacy. `saveUserText` and `saveLLMOutput` default to enabled, so host deployments may need to override them.
- Do not block the engine loop on trace flushing during normal runs; preserve fire-and-forget behavior unless changing the contract intentionally.
- Changes to hook usage, exported options, metadata shape, or service registration should route through `../../harness/skills/contract-coding.md`.

## Common Commands

```bash
pnpm --filter pulse-coder-langfuse-plugin build
```

`test` currently has no test files and exits non-zero. `typecheck` currently hits TS6059 because the package imports workspace source from `packages/engine` and `packages/orchestrator` outside this package's `rootDir`; prefer `build` until that TypeScript boundary is fixed.

## Key Files

- `src/index.ts`: `createLangfusePlugin`, option resolution, hook registration, usage normalization, trace/span lifecycle, and default export.
- `package.json`: package exports, build scripts, and Langfuse/engine dependencies.
- `tsup.config.ts`: build output configuration.
