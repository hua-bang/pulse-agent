# Memory Plugin Docs

Design documents for the host-side memory system. Engine SDK itself stays memory-agnostic; memory ships as a host-side plugin in `packages/memory-plugin/`.

> **Status caveat.** `product-design.md` and `technical-design.md` are `Status: draft` (dated 2026-02-19); `memory-production-v1.md` is `Status: proposed` (dated 2026-02-22). They predate the shipped implementation and have diverged from it. Treat them as background design intent, not a description of current code.
>
> **What diverged.** The docs specify `/memory` slash commands (`/memory`, `/memory pin <id>`, `/memory forget <id>`, `/memory off`) and a `Middleware` contract (`beforePrompt` / `afterPrompt` / `onToolResult`). The shipped package registers **no slash commands** and uses **no middleware chain** — it exposes memory through three tools (`memory_recall`, `memory_get_daily_log_by_day`, `memory_record`) and `EnginePlugin` hooks (`beforeRun`, `onCompacted`). The suggested `src/middleware/...` / `src/memory/...` / `src/commands/...` layout in `technical-design.md §13` also does not match the actual `src/` tree.
>
> **For current behavior, defer to the implementation package** — see Implementation below.

## Implementation

The shipped memory system lives in [`packages/memory-plugin/`](../../packages/memory-plugin/). Its [`AGENTS.md`](../../packages/memory-plugin/AGENTS.md) is the SSOT for current code, interfaces, and constraints (memory scopes, tools, hooks, layered state store, embeddings, daily-log policy, compaction writes). The package [`README.md`](../../packages/memory-plugin/README.md) gives a package-level overview.

Features the design docs predate and that `packages/memory-plugin/AGENTS.md` documents as implemented: soul memory (`recordSoul` / `recallSoul` / `listSoul`), daily-log quality gates / quotas / dedupe / day keys / shadow mode, compaction write policy via the `onCompacted` hook, layered state store under `baseDir/{platformKey}/{user,soul,daily}`, and OpenAI + hash embedding providers backed by a SQLite vector store.

## Documents

- `docs/memory-plugin/product-design.md`
  - `Status: draft`. Product goals, user scenarios, feature scope, UX, metrics, and rollout.
- `docs/memory-plugin/technical-design.md`
  - `Status: draft`. Architecture, middleware contracts, data model, retrieval/write pipelines, security, and operations. The middleware contract and suggested code layout herein are **not** what shipped — see Implementation.
- `docs/memory-plugin/memory-production-v1.md`
  - `Status: proposed`. Practical production write policy for explicit long-term memory and selective daily-log memory.

## Related Work

- Existing draft doc in app scope has been superseded by this folder-level split design.
