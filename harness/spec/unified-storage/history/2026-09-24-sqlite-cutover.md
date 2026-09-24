# 2026-09-24 — SQLite cutover decisions (PR #1035)

Decision record for phase S1 and its review round. Current behavior is
described by the Knowledge owners routed from the spec README; this file keeps
why each choice was made and what was rejected.

## Use SQLite for Canvas structure and conversations

- **Chosen:** a SQLite (WAL) adapter behind asynchronous domain repositories,
  one database per data root, shared by the app and the CLI.
- **Rejected:** keeping JSON files and extending the CLI lock to the app. The
  lock covered only CLI-to-CLI writes, whole-file rewrites had no transaction,
  and per-node `updatedAt` arbitration could drop the slower writer's changes.

## Record migration authority in the database

- **Chosen:** each domain's `staging` / `active` state lives in the database;
  `__storage__.json` only mirrors it and is repaired from it.
- **Rejected:** trusting the marker file alone. A lost or stale marker would
  re-import legacy JSON over newer SQL edits.
- **Review follow-up:** a database with no activation rows and no domain data
  (a crash before the first `begin()`) counts as not yet cut over and restarts
  migration. A database with data but no authority still fails closed.

## Keep Markdown and attachments as files

- **Chosen:** files remain authoritative; the database stores write intents,
  hashes, and recovery snapshots, never an editable copy.
- **Rejected:** moving content into SQLite. Terminal agents (Claude Code,
  Codex, Pi), `AGENTS.md`, editors, git, and search tools all operate on real
  files. Binary attachments would inflate the database, WAL, and every backup.
  A damaged database page would affect every note instead of one file.
- **Consequence:** unified backup and full-text search are not solved by S1.
  They are planned as derived features (export snapshot, FTS index built from
  files) rather than by relocating content. Abstracting file access behind an
  interface (S3) was agreed as the direction on the same day.

## Replace permanent workspace deletion with soft delete

- **Chosen:** `workspace_trash` hides Canvas and conversations in one
  transaction and keeps everything restorable; restore advances revisions so
  pre-deletion snapshots cannot write.
- **Rejected:** keeping `rm -rf` of the workspace directory, which deleted
  conversations and Markdown with no recovery.

## Skip unreadable legacy session files during conversation cutover

- **Options:** (A) stop startup on any unreadable file until the user repairs
  it; (B) skip only files whose content cannot be read as a session, migrate
  the rest, record and announce the skipped list.
- **Chosen:** B, by maintainer decision. One stale archive should not make the
  whole app unusable, and a skipped file had no readable content to lose.
- **Still fail closed:** unsupported future schemas, I/O errors, files that
  vanish mid-read, and conflicting archive copies with no reliable newest
  version. Sources are never moved or rewritten.
- **Accepted cost:** after cutover a repaired file is not re-imported
  automatically; a re-import path waits for user demand.

## Bound the change log

- **Chosen:** keep the newest 10,000 entries, pruned inside the inserting
  transaction; `AUTOINCREMENT` keeps pruned sequences from being reused. A
  cursor older than the retained log rejects with `revision_conflict`, and the
  app observer resumes from the latest cursor.
- **Rejected:** unbounded growth (the only reader starts at the latest cursor,
  so history was never read) and silently skipping pruned entries.

## Reject cross-architecture packaging

- **Chosen:** an Electron Builder `beforePack` gate refuses a target whose
  platform/arch differs from the single staged SQLite binding.
- **Rejected for now:** cross-compiling the binding, because preparation loads
  and verifies it with the host Electron, which cannot run another
  architecture's binary.

## Do not migrate external agent transcripts

- **Chosen:** Claude Code, Codex, and Pi keep their own session storage; Pulse
  stores only resume ids (on Canvas nodes, now in SQL).
- **Rejected:** copying transcripts into the Pulse database, which would create
  a second source of truth tied to each vendor's private format.
- **Left open:** the chat-role id map in `external-agent-state.json` is still a
  JSON file (spec S2/S4).

## Resolve divergent v1 node copies like the v1→v2 migration

Found by a real-data dry run: 6 workspaces kept a v1 `canvas.json` with full
node bodies while 63 of those nodes also had different `nodes/<id>.json`
files. The first cutover stopped startup on this state.

- **Chosen:** apply the rule `migrateToV2` already used when the app opened
  such a workspace. The node file wins when the inline copy is empty or its
  `updatedAt` is strictly newer; otherwise `canvas.json` wins. The result
  matches what users would have seen after opening the workspace in the
  previous release.
- **Rejected:** stopping startup, which blocked every workspace for a state the
  previous release handled; and always preferring `canvas.json`, which would
  diverge from that release whenever the node file was newer.
- **Kept safe:** neither file is changed, both copies of each differing field
  are recorded under `__storage-backup__`, and the user is told which
  workspaces were affected. Migration failures now also carry the underlying
  reason instead of a generic message.

