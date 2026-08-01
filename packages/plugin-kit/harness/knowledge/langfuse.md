# Langfuse module (`src/langfuse/`)

Formerly the standalone `packages/langfuse-plugin` workspace; folded into
plugin-kit as the `pulse-coder-plugin-kit/langfuse` subpath export
(`createLangfusePlugin`). Sole consumer: `apps/remote-server`
(`src/core/langfuse.ts`). Single-file module (`index.ts`), no specs.

## Positioning

Optional Langfuse observability: an engine plugin registering lifecycle
hooks for traces, LLM generations, tool spans, compaction events, run
metadata, and shutdown flushing. Core engine hook contracts belong in
`packages/engine`; host-specific telemetry policy belongs in the host that
configures this plugin.

## Invariants

- Stay optional and safe to disable when Langfuse keys are absent.
- Credentials are env-only: `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`,
  `LANGFUSE_HOST`/`LANGFUSE_BASEURL`.
- Trace payload privacy is a deliberate setting: `saveUserText` and
  `saveLLMOutput` default to ENABLED — host deployments may need to
  override them.
- Do not block the engine loop on trace flushing during normal runs;
  preserve fire-and-forget behavior unless changing the contract
  intentionally.
