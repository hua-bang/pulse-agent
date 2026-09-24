# Unified Storage

Status: phases S1 and S2 are merged (PR #1035, 2026-09-24); S3 is shelved and
later phases are planned targets. Current behavior is owned by the
Knowledge resources routed below — this spec owns the intended end state and
the delivery order, not a second description of what already exists.
Decision trail: [history/](history/).

## Why this exists

Canvas structure, Canvas Agent conversations, and workspace files were written
by the app and by `canvas-cli` as whole JSON files with no shared transaction
or cross-process version check; the CLI lock was never taken by the app.
Deleting a workspace removed its conversations and notes permanently. The
storage work replaces that with one host-neutral persistence layer and moves
the remaining file-backed state behind it in stages.

This is a cross-workspace migration (`packages/storage`,
`apps/canvas-workspace`, `packages/canvas-cli`), so the spec lives at the root.

## Target architecture

The end state these phases converge on:

- **One domain API.** Hosts use asynchronous domain repositories from
  `@pulse-coder/storage`. SQL, database handles, and driver types never reach
  host code, so a remote adapter can replace the local one.
- **One authority per domain.** Each domain has exactly one source of truth at
  a time. For migrated domains the database records that authority; filesystem
  markers only mirror it, and legacy sources are never re-imported after
  cutover.
- **Versioned writes.** Every mutation commits its records, revision, and
  change-log entry together and rejects stale revisions. The change log is
  bounded; a reader whose cursor fell out of it must resynchronize, never
  silently skip.
- **Files stay files, behind an interface.** Markdown and attachments remain
  ordinary files that agents, editors, and git can use directly. Hosts reach
  them through a file repository addressed by URI and content version; only
  consumers that need a real path (terminal agents, `AGENTS.md`) ask for one
  explicitly.
- **External transcripts stay external.** Claude Code, Codex, and Pi own their
  own session storage. Pulse stores only the ids that let a node or chat role
  resume them.
- **Deletion is recoverable.** User deletion hides data and keeps it restorable;
  permanent removal is reserved for compensating unpublished writes.

## Where current facts live

| Topic | Owner |
|---|---|
| Storage package boundaries and contracts | `packages/storage/AGENTS.md`, `packages/storage/src/contracts.ts` |
| Backend authority, CLI/app arbitration, change log, file recovery | `packages/canvas-cli/harness/knowledge/storage-concurrency.md` |
| Conversation cutover, skipped legacy files, session runtime | `apps/canvas-workspace/harness/knowledge/chat-sessions.md` |
| Canvas main-process storage and domain map | `apps/canvas-workspace/harness/knowledge/main-domain-modules.md` |
| SQLite native binding preparation and packaging gate | `apps/canvas-workspace/harness/knowledge/packaged-tooling.md` |
| Confirmed unfixed storage defects | `apps/canvas-workspace/harness/knowledge/known-defects.md` |
| Validation and consumer checks | `packages/storage/harness/validate/validation.yaml`; root overlay `storagePublicApiChange` |

## Delivery order

| Phase | Deliverable | Status | Completion condition |
|---|---|---|---|
| S1 | SQLite for Canvas structure and Canvas Agent conversations | Merged, PR #1035 | Merged with CI green; standard acceptance and storage consumer checks pass |
| S2 | Hardening of the S1 boundaries | Merged, PR #1035 | Each item below landed with a regression test |
| S3 | File repository for Markdown and attachments | Shelved; direction agreed, no design yet | Markdown and attachment access in Canvas main goes through it |
| S4 | Remaining JSON domains | Needs decision | Each domain either migrated or explicitly kept as a file with a stated reason |
| S5 | Remote adapter or multi-device sync | Not planned | Starts only with a product decision to sync |

Each phase must be independently mergeable. S2 does not wait for S3.

### S1 — Merged (PR #1035)

- `@pulse-coder/storage` with the SQLite (WAL) adapter: domain repositories,
  revision and generation checks, change log, backups, and integrity checks.
- App-owned cutover of Canvas and conversations with database-recorded
  activation (schema v2), verified backups, and retained legacy JSON.
- Workspace soft delete and restore across Canvas and conversations
  (schema v3); CLI `workspace trash` / `workspace restore`.
- File write intents committed with Canvas records, compare-and-swap file
  replacement, and startup recovery.
- Review hardening landed in the same PR:
  - A pristine database restarts cutover instead of blocking startup.
  - Imports are deduplicated against manifest refreshes.
  - Cross-architecture packaging is rejected before pack.
  - CLI `status` reports unavailable storage, and CLI workspace creation
    compensates its SQL row.
  - The change log is bounded and expired cursors fail.
  - Unreadable legacy session files are skipped and reported.

### S2 — Hardening (merged)

| Gap closed | Owner | Guard |
|---|---|---|
| A crash before the first schema transaction committed stopped every later startup | `packages/storage` (`local.ts`, `sqlite/index.ts`) | `local-authority.test.ts`; foreign databases still fail closed |
| A hard interrupt between the import's database commit and manifest publication needed manual recovery | `apps/canvas-workspace` (`persistence/import-recovery.ts`) | `import-recovery.test.ts`, `storage-lifecycle.test.ts` |
| Concurrent chat-role saves could drop CLI session ids in `external-agent-state.json` | `apps/canvas-workspace` (`agent/external/state-store.ts`) | `state-store.test.ts`; the file stays JSON until S4 |
| The CLI opened the database several times per command | `packages/canvas-cli` (`core/sqlite-store.ts`) | `storage-session.test.ts` |
| Trash, restore, and every commit recompiled SQL statements | `packages/storage` (`sqlite/workspaces.ts`, `sqlite/index.ts`) | Existing trash/restore and commit suites |

### S3 — File repository (shelved)

Shelved on 2026-09-24: with no sync on the roadmap, the immediate gain (one
version scheme for file reads and writes, easier testing) does not yet justify
the cost. Revisit when Markdown access is reworked anyway or when S5 starts.

Introduce a `WorkspaceFiles` repository in `packages/storage` beside the
existing repositories: read with content version, compare-and-swap write,
watch, list, and an explicit local-path escape hatch. Its first adapter wraps
the current local file adapter and watcher.

1. Route Markdown node reads, writes, and external-edit indexing through it,
   sharing one version scheme with file write intents.
2. Route attachments and the remaining main-process file reads.

Out of scope for S3: moving file content into SQLite (rejected, see history),
and a remote adapter. Optional follow-up once S3 lands: a full-text index
(SQLite FTS5) derived from files, rebuildable from them.

### S4 — Remaining JSON domains (needs decision)

| Domain | Current store | Proposed direction |
|---|---|---|
| External chat-role CLI session ids | `~/.pulse-coder/canvas/external-agent-state.json` (serialized, atomic since S2) | Store in the owning conversation's metadata so it commits, trashes, and restores with the conversation |
| Scheduled tasks, Task, Goal | `scheduled-tasks.json` and related files | Decide per domain; not part of the S1 scope |
| Workspace manifest (names, folders, order) | `__workspaces__.json` | Keep as a file unless S5 needs it in the database |

## Open questions

- Should skipped legacy session files get a re-import path? Add one only if
  users report needing it; today a repaired file is not picked up after cutover.
- Which S4 domains move, and in what order?
- Is S5 (sync) on the product roadmap at all? S3's interface should not assume
  it.

## Verification

Use the root runner at `standard` for each phase and run the
`storagePublicApiChange` consumer checks whenever `packages/storage` public
contracts change. Packaging or native-binding changes also need the
release-level packaged-tooling scenario. Record run evidence in the PR, not
here.
