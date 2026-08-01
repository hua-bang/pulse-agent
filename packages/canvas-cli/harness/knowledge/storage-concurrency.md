# Store Concurrency — packages/canvas-cli

Read this before changing any canvas write path in `src/core/store.ts` /
`src/core/storage-v2.ts` or adding a new mutating command. The enforceable
rules live in this workspace's `AGENTS.md` §Local Constraints (workspace lock,
no full-sync sweep); this file records the incident that produced them and the
facts the rules compress away.

## The incident (parallel writers destroyed each other's nodes)

Every mutation once did an unlocked full-canvas read→modify→write. Two
concurrent CLI writers would:

- hit tmp-rename `ENOENT` crashes — the per-node writer used a FIXED
  `<path>.tmp` name, so two writers raced the same temp file;
- lose updates — the last full-canvas save won, persisting a stale in-memory
  copy of the other writer's nodes;
- worst: the v2 orphan sweep deleted per-node files the other writer had just
  created — a full sync sweep treated "unknown to my snapshot" as "orphan".

## The guards

- Unique tmp names per write (no shared `<path>.tmp`).
- `withWorkspaceLock` around `commitNodeMutation`/`commitEdgeMutation`
  (`src/core/store.ts`): every full load→mutate→save cycle holds the
  per-workspace lock (`<storeRoot>/__locks__/<id>.lock`).
- Orphan pruning is opt-in (`pruneUnknownNodeFiles`), reserved for
  restore/repair flows — a normal save deletes per-node files only for ids
  the mutation explicitly removed.
- Regression suite: `src/core/__tests__/storage-race.test.ts`.

## The boundary that still stands

The lock serializes CLI↔CLI only. The app does not take it: app↔CLI
concurrency relies on per-node `updatedAt` arbitration alone, and that stays
true until a shared storage package lands.
