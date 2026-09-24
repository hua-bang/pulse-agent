# 2026-09-24 — S2 hardening decisions

Decision record for the S2 items. Current behavior is described by the
Knowledge owners routed from the spec README.

## Uninitialized database files restart the cutover

- **Chosen:** a database file with `user_version` 0 and no schema objects is
  treated like a missing database, so legacy files stay authoritative and the
  next start imports them again.
- **Rejected:** treating every `user_version` 0 file as pristine. A file with
  foreign tables is not evidence of an interrupted Pulse cutover and still
  fails closed.

## Interrupted imports are completed, not rolled back

- **Chosen:** when SQL already holds the imported workspace, startup publishes
  its manifest entry. The user asked for the import and every record is present.
- **Rejected:** compensating with `removeBundle`, which would discard a
  complete import to reach the same state the user would recreate by importing
  again.
- **When SQL never received it:** the directory is moved to
  `__storage-backup__/interrupted-imports/` rather than deleted; the source
  archive also still exists.
- **Selection:** recovery does not change the active workspace, because it is
  not a user action.
- **Failure:** recovery is best effort and never blocks startup; the
  unrecovered state is the same as before recovery existed.

## Chat-role session ids: fix the writer now, move the data later

- **Chosen:** serialize read-modify-write in-process and replace the file
  atomically. Only the app process writes this file.
- **Deferred to S4:** storing the ids in conversation metadata, which also
  makes them follow workspace trash and restore.

## One database connection per CLI command

- **Chosen:** the CLI entry opens a storage session; `withSqliteCanvas` shares
  one connection per data root inside it and closes all on exit. Concurrent
  calls share the pending open.
- **Not cached:** a root without an active database, because the app may
  finish activation while the command runs.
- **Unchanged:** library callers and tests outside a session still open and
  close per access.
