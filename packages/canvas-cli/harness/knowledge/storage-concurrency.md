# Store Concurrency — packages/canvas-cli

Read this before changing a canvas write path, backend selection, file recovery,
or a mutating command. `src/core/store.ts` is the compatibility facade;
`sqlite-store.ts` selects the active adapter from `@pulse-coder/storage`.

## Backend authority and first upgrades

- SQLite records whether each local domain is staging or active; `__storage__.json`
  mirrors the completed cutovers. If the marker is missing, an active database
  restores it without importing old JSON. Only a database explicitly marked staging,
  or activation limited to conversations, leaves Canvas on its legacy JSON path.
  Unknown authority (including an old SQL schema with a missing marker) fails closed.
- Before selecting the Canvas backend, the CLI opens any active database and
  reconciles its full activated-domain set with the marker. A stale marker that
  lists only conversations cannot hide active SQL Canvas records from read, list,
  or status. Native binding resolution is passed lazily into both database opens
  and legacy write fences, including manifest, doctor, and restore paths. A root
  without a database does not load a native binding.
- The app imports and activates data; CLI reads do not migrate it. v1/v2 and
  records without revisions remain readable before activation. After activation,
  old `canvas.json`, `.bak`, and `nodes/` files are not current state and must not
  be used as a fallback when SQLite fails.
- `withLegacyCanvasWrite` fences legacy saves, repair, restore, and manifest
  writes against migration. Manifest-only writes allow an active backend but
  still respect the migration lock. `restore` is a v1 recovery tool and refuses
  active SQLite storage.
- SQL workspace discovery uses repository records, not the existence of a
  `canvas.json` file. `status` reports `json`, `sqlite`, or unavailable storage.

Guards: `src/core/__tests__/sqlite-store.test.ts` covers v1/v2 with no revision,
unpublished staging databases, SQL-only workspaces, corrupt markers, missing
active databases, and legacy-restore refusal.

## SQLite concurrency and file recovery

The shared adapter commits Canvas records, its revision, and the change cursor
in one SQLite transaction. `storageGeneration` identifies the database;
`revision` identifies a committed workspace snapshot. Carry both from the
original read. Re-reading a current revision and attaching it to old data is
not conflict detection. `commitNodeMutation` and `commitEdgeMutation` therefore
require the caller's original revision/generation on the SQL path. Full saves
use the same condition. A stale mutation fails rather than overwriting it.

Canvas placements and knowledge atoms are separate. Removing a placement does
not prune off-canvas atoms; only explicit atom removals do. Plugin payloads,
properties, links, and draw order round-trip through the shared compatibility
adapter. The app observes committed changes rather than watching SQLite/WAL
files; the CLI notifier remains a no-op and no runtime socket is needed.

Markdown remains the source of truth. `sqlite-file-writes.ts` prepares hashes
and recovery snapshots before mutation; Canvas CAS and file intent staging
commit together. Only then does the local file adapter compare and replace the
file. Repeated writes within an `apply` plan coalesce to final content; multiple
nodes writing the same URI in one plan are rejected. A failed CAS produces no
intent or Markdown effect.

Filesystem replacement and database acknowledgement are separate steps. A
failure returns `file_write_pending` or `file_write_conflict` with intent ids;
the durable intent preserves base and requested content. `doctor --repair`
retries pending/errors, acknowledges already-written target bytes, preserves
external conflicts, and refreshes indexes from regular source files. It does
not reconstruct a missing source from its cache. Successful or failed recovery
refreshes the caller's complete snapshot when available, never only its revision.
External editors do not share the write lock: hash checks plus rename are
optimistic, not an atomic filesystem compare-and-swap.

Guards: `src/core/__tests__/sqlite-file-recovery.test.ts` covers CAS rejection,
interrupted/partial batches, failed replacement, restart recovery, external
conflicts, index reconciliation, and refusal to recover through corrupt storage.
Shared repository transaction tests belong in `packages/storage`.

## Recoverable workspace deletion

`workspace delete --confirm` uses the shared workspace trash operation. It hides
the Canvas and its conversation scope without removing records, current-session
pointers, Markdown, attachments, or legacy source files. A concurrent conversation
change rejects the operation rather than hiding newer activity based on an old
snapshot. Deleted workspaces cannot accept new writes or be recreated from stale
snapshots. Other workspace and global scopes remain unchanged.

`workspace trash` lists retained workspaces; `workspace restore <id>` restores
the same identities, name, content and conversation pointer. There is no automatic
expiry or permanent-delete command. File bytes are never rewritten by restoration;
external file edits made while a workspace is in trash remain intact.

The database is authoritative for visibility. Manifest reads filter deleted ids,
including an old primary/backup manifest left after an interrupted deletion.
Restoration publishes the saved manifest entry before restoring SQL visibility;
if that write fails, the workspace remains in trash and can be retried. The shared
root migration fence and workspace lock serialize CLI deletion/restoration.
The manifest and database are still separate commits, not one filesystem/SQL
transaction. Reads hide a prematurely published entry until restoration commits.

Legacy-only stores must first be opened in the updated app to activate storage.
Deletion/restoration refuses those stores without removing files; it never falls
back to irreversible directory deletion. The top-level `restore` command remains
the separate legacy v1 snapshot-recovery tool.

Guards: `src/core/__tests__/workspace-trash.test.ts` covers retention/restoration,
other-scope isolation, old-snapshot rejection, concurrent chat activity, interrupted
manifest updates, external file preservation, and CLI command output.

## The incident (parallel writers destroyed each other's nodes)

Every mutation once did an unlocked full-canvas read→modify→write. Two
concurrent CLI writers would:

- hit tmp-rename `ENOENT` crashes — the per-node writer used a FIXED
  `<path>.tmp` name, so two writers raced the same temp file;
- lose updates — the last full-canvas save won, persisting a stale in-memory
  copy of the other writer's nodes;
- worst: the v2 orphan sweep deleted per-node files the other writer had just
  created — a full sync sweep treated "unknown to my snapshot" as "orphan".

## Legacy JSON guards

- Unique tmp names per write (no shared `<path>.tmp`).
- `withWorkspaceLock` around `commitNodeMutation`/`commitEdgeMutation`
  (`src/core/store.ts`): every full load→mutate→save cycle holds the
  per-workspace lock (`<storeRoot>/__locks__/<id>.lock`).
- Orphan pruning is opt-in (`pruneUnknownNodeFiles`), reserved for
  restore/repair flows — a normal save deletes per-node files only for ids
  the mutation explicitly removed.
- Regression suite: `src/core/__tests__/storage-race.test.ts`.

For unactivated stores, the directory lock serializes CLI↔CLI only; App↔CLI
coordination still uses `updatedAt` arbitration. Legacy `revision` counts CLI
writes only. These limitations do not describe the active SQLite adapter.
