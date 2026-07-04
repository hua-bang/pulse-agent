# AGENTS.md - packages/memory-plugin

> Local entry for `packages/memory-plugin`.
> Repository harness entry: `../../harness/README.md`.

## Module Positioning

`pulse-coder-memory-plugin` owns host-side memory service integration for Pulse Coder runtimes. It provides a file-backed memory service, engine plugin integration, memory tools, daily-log extraction, semantic/keyword recall, embeddings, and layered state storage.

Memory behavior should preserve the boundary between user/profile memory, hidden `soul` memory, daily-log/session memory, project/repository knowledge, and runtime session logs.

## Knowledge Navigation

| Task | Read |
|---|---|
| Package overview | `README.md` |
| Background design | `../../docs/memory-plugin/technical-design.md` |
| Public exports | `src/index.ts` |
| Types | `src/types.ts` |
| Engine integration and tools | `src/integration.ts` |
| Memory service | `src/service.ts` |
| Daily-log write policy | `src/service/daily-log.ts` |
| Extraction rules | `src/service/extraction.ts` |
| Recall prompt/scoring helpers | `src/service/recall.ts`, `src/service/models.ts` |
| Layered state files | `src/service/state-store.ts` |
| Embeddings and vector storage | `src/embedding-env.ts`, `src/embedding/` |
| Write policy env config | `src/write-env.ts`, `src/config/env-utils.ts` |
| Tests | `src/service.test.ts`, `src/integration.test.ts` |
| Package scripts | `package.json` |

## Local Constraints

- Do not treat non-versioned runtime memory as repository SSOT.
- Keep secret/API-key handling environment-based and out of committed files.
- Normal recall intentionally targets `daily-log` items; user-scope rules/facts are auto-injected in `beforeRun`, and `soul` memory is hidden unless explicitly requested through the soul/all paths.
- Daily-log writes have quality gates, quota controls, dedupe keys, day keys, and optional shadow mode. Preserve those controls when changing extraction or write policy.
- Semantic recall must degrade safely to keyword/recency behavior when embeddings or SQLite vector storage are disabled or unavailable.
- Layered storage lives under `baseDir/{platformKey}/user`, `soul`, and `daily`; legacy `state.json` migration/backups are part of the compatibility contract.
- Changes to recall/write/compaction behavior should include tests or explicit manual evidence.
- Repository-rule changes belong in the root harness, not silently in memory docs or prompts.

## Common Commands

```bash
pnpm --filter pulse-coder-memory-plugin build
```

Docs-only changes can use the harness docs rule: check referenced paths and commands instead of running package build/test.

`test` is part of harness validation, but in this checkout it currently fails one vector-store coverage case because the local `better-sqlite3` native binding is missing for the active Node runtime; the other memory tests pass. `typecheck` currently fails locally with TS6059 `rootDir` errors because the package imports `pulse-coder-engine` source and that pulls engine/orchestrator files outside `packages/memory-plugin/src`.

## Key Files

- `src/index.ts`: public package entry.
- `src/types.ts`: public memory item, policy, input, result, and embedding contracts.
- `src/service.ts`: `FileMemoryPluginService`, session toggles, explicit writes, daily-log writes, soul memory, recall, pin/forget, compaction, and embedding commits.
- `src/integration.ts`: `createMemoryIntegration`, env-based integration, engine hooks, memory tools, auto-injected user/soul prompt, and compaction writes.
- `src/service/state-store.ts`: layered file layout and legacy migration.
- `src/service/daily-log.ts`: daily-log quotas, quality gates, dedupe, and logging.
- `src/service/extraction.ts`: rule-based extraction from user/assistant/compaction text.
- `src/embedding/hash-provider.ts`: default local embeddings and cosine helpers.
- `src/embedding/openai-provider.ts`: OpenAI-compatible embedding provider from env.
- `src/embedding/vector-store.ts`: SQLite vector table helpers using `better-sqlite3`.
- `src/service.test.ts`, `src/integration.test.ts`: service and engine-plugin behavior coverage.
