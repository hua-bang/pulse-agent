# Memory module (`src/memory/`)

Formerly the standalone `packages/memory-plugin` workspace; folded into
plugin-kit as the `pulse-coder-plugin-kit/memory` subpath export. Public
API unchanged (`createMemoryIntegration`, `createMemoryIntegrationFromEnv`,
`FileMemoryPluginService`, tools, types). Consumers: `apps/remote-server`
(`src/core/memory-integration.ts`) and `packages/cli`
(`src/memory-integration.ts`). Background design docs live at
`../../../../docs/memory-plugin/`.

## Positioning

Host-side memory service integration: file-backed memory service, engine
plugin integration, memory tools, daily-log extraction, semantic/keyword
recall, embeddings, layered state storage. Preserve the boundary between
user/profile memory, hidden `soul` memory, daily-log/session memory,
project/repository knowledge, and runtime session logs.

## Invariants

- Non-versioned runtime memory is NOT repository SSOT; secret/API-key
  handling stays environment-based and out of committed files.
- Normal recall intentionally targets `daily-log` items; user-scope
  rules/facts are auto-injected in `beforeRun`; `soul` memory stays hidden
  unless explicitly requested through the soul/all paths.
- Daily-log writes have quality gates, quota controls, dedupe keys, day
  keys, and optional shadow mode — preserve these when changing extraction
  or write policy (`service/daily-log.ts`, `service/extraction.ts`).
- Semantic recall MUST degrade safely to keyword/recency behavior when
  embeddings or SQLite vector storage are disabled or unavailable
  (`embedding/vector-store.ts` uses `better-sqlite3`; this is why
  plugin-kit carries the native dep).
- Layered storage lives under `baseDir/{platformKey}/user`, `soul`, and
  `daily`; legacy `state.json` migration/backups are part of the
  compatibility contract (`service/state-store.ts`).
- Changes to recall/write/compaction behavior need tests or explicit
  manual evidence — the module owns plugin-kit's only real specs
  (`service.test.ts`, `integration.test.ts`).

## Key files

- `index.ts` — public module entry (subpath export target).
- `types.ts` — memory item, policy, input, result, embedding contracts.
- `service.ts` — `FileMemoryPluginService`: session toggles, explicit +
  daily-log writes, soul memory, recall, pin/forget, compaction, embedding
  commits.
- `integration.ts` — `createMemoryIntegration(FromEnv)`, engine hooks,
  memory tools, auto-injected user/soul prompt, compaction writes.
- `embedding/hash-provider.ts` / `embedding/openai-provider.ts` — default
  local embeddings vs OpenAI-compatible provider from env.
- `write-env.ts`, `config/env-utils.ts` — write-policy env config.
