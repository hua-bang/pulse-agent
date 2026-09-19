# AGENTS.md - packages/storage

This package owns host-neutral persistence contracts and local adapters shared
by Canvas, its CLI, and other hosts. Read the root AGENTS and harness/README.md.

## Boundaries

- Public repositories describe domain operations, revisions, and typed failures;
  never expose SQL, database handles, Electron, or driver types to consumers.
- SQLite is an adapter. Keep transaction callbacks internal and synchronous;
  public operations are asynchronous so remote adapters can implement them.
- A mutation's records, revision, and change notification commit together.
  Reject stale revisions instead of silently overwriting newer state.
- User workspace deletion uses `workspaces.trashBundle`; preserve records,
  current pointers, and file intents until explicit restoration. Keep permanent
  `removeBundle` for import compensation, not user deletion. Trashed reads are
  hidden and writes reject; restore must invalidate all pre-deletion revisions.
- Markdown and attachments remain files. Persisted content snapshots and indexes
  are not independent editable copies of their source files.
- Preserve unknown node and plugin payload fields during migration and round trips.
- Tests use temporary databases and fixture files, never user runtime directories.
- Keep schema migration, integrity checks, and consistent backups in the adapter;
  hosts own when a legacy store is imported and switched over.

## Validation

Use `harness/validate/validation.yaml`. Public contract changes require Canvas
and canvas-cli consumer checks through the root validation overlay.
