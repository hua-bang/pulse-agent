# 2026-11-01 — Workspace manifest moves into storage

Decision record for the S4 workspace manifest row. The earlier direction, "keep
as a file unless S5 needs it", had no recorded decision. The project owner
decided to migrate. Current behavior is described by the Knowledge owners the
spec routes to.

## Why

Creating, deleting, restoring, and importing a workspace each commit the
manifest file and the database in two steps. Consistency depends on patches:
`import-recovery.ts`, read-time filtering of trashed ids, and self-healing on
the next save (`packages/canvas-cli/harness/knowledge/storage-concurrency.md`).
With the manifest in the database, stage 2 can make each of these one
transaction.

## Compatibility rule: the database wins, the file is imported once

- **Chosen:** for a store whose `canvas` domain is active, the first read or
  write imports `__workspaces__.json` once, under the root migration fence and
  the storage lock. After that, hosts read and write only the database. Legacy
  stores keep the file unchanged.
- **Rejected:** "read the file when the database has none" on every read. After
  a rename, deletion, or crash the file can hold old names or deleted
  workspaces, and that fallback would bring them back. It also breaks two
  existing rules: authority is never inferred from whether a file or record
  exists (`packages/storage/src/local.ts`), and an active Canvas never falls back
  to JSON.

## No new activation domain

- **Chosen:** the presence of the `workspace_manifest` document is the import
  state. It only exists after Canvas activation.
- **Rejected:** a `workspace-manifest` row in `local_activations`. That needs a
  rebuilt CHECK and changed validation in `local.ts` and
  `sqlite/local-activation.ts`, and an older App or CLI that opens the database
  rejects the whole store (fail closed).

## Storage shape

- **Chosen:** one singleton row (`workspace_manifest`, like `storage_identity`)
  whose body is the whole manifest JSON. Unknown top-level keys and `folders`
  round-trip without a schema change. Commits use `expectedRevision` (`null`
  creates) and an optional generation, and log one `workspace-manifest` change
  whose `changedIds` are the entries added, removed, or changed.
- **Open:** one row per workspace. Not chosen for stage 1; listed for the
  owner's decision.
- Schema v4 rebuilds `resource_versions` and `storage_changes` to widen their
  domain CHECK. Nothing has a foreign key to them. Sequences are copied and the
  `sqlite_sequence` high-water mark is kept, so cursors stay valid and pruned
  sequences are not reused.

## Transitional JSON mirror

- **Chosen:** after each database commit, the same document is written to
  `__workspaces__.json` with an atomic rename. Direct readers not yet on storage
  (`agent/workspace/workspace-meta.ts`, the channel plugin) and older builds keep
  working. A mirror failure is logged; the next commit rewrites it. New code
  never reads the mirror.
- The App does not watch the manifest file. The renderer refreshes on SQL
  Canvas changes (a new or deleted workspace), so the mirror is not needed for
  CLI-to-App updates. Subscribing the renderer to `workspace-manifest` changes
  is left to stage 2.

## Stage 2 (not delivered)

- `trashBundle`, `restoreBundle`, `importBundle`, and workspace creation update
  the manifest in the same transaction. Then remove create compensation, the
  restore "manifest first" order, the manifest part of `import-recovery`, and
  read-time trash filtering.
- Stop writing the mirror once every reader uses storage.

## Open decisions

- Downgrade: edits an older build makes to the file are ignored after the
  document exists. Accept, or write the revision into the mirror and detect a
  newer file at startup?
- One document or one row per workspace.
