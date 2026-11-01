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

## One transaction per workspace change (stage 2)

- **Chosen:** `importBundle`, `trashBundle`, and `restoreBundle` take an
  optional manifest commit and run it in their own transaction. CLI creation is
  `importBundle` with the new entry. A stale manifest revision rolls back the
  bundle change too. `updateLocalWorkspaceManifest` takes the committer, so
  hosts keep one read-update-commit path under the storage lock.
- **Removed:** CLI create compensation (`removeBundle` after a failed
  publish), the "manifest first" restore order, and the App import
  compensation with its `database-committed` journal phase.
- **Kept:** `import-recovery` still publishes a missing entry for a journal at
  `database-committed`. Released builds write that phase; the step is
  idempotent. New imports leave only a `prepared` journal, which recovery sets
  aside or, after a commit, removes. Read-time filtering of trashed ids also
  stays: it protects documents imported from older files.

## The JSON mirror (stage 1 only)

- Stage 1 wrote each committed document back to `__workspaces__.json` for
  direct readers (`agent/workspace/workspace-meta.ts`, the channel plugin).
  Stage 2 moved both readers to storage and stopped the mirror. The file is
  retained legacy data after the import.
- An older build cannot open a schema v4 database (`initializeSchema` rejects a
  newer `user_version`), so no older reader depends on the mirror.
- The App does not watch the manifest file. The renderer refreshes on SQL
  Canvas changes. Subscribing the renderer to `workspace-manifest` changes is
  not done.

## Open decisions

- One document or one row per workspace.
- Downgrade: older builds stop on a v4 database (fail closed). Confirm that this
  is acceptable.
