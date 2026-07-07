# Known Defects

Confirmed-but-unfixed defects in `apps/canvas-workspace` — the intended
behavior is not in question, only the fix is outstanding. Same admission rule
as `packages/engine/harness/knowledge/known-defects.md`: a judgement call
about *what should be true* is a spec question, not a defect; an entry here
has a confirmed cause and an owed fix. Fix one → cover it with a regression
test and delete its entry.

## LIVE (user-visible behavior is degraded today)

### File-watcher sync is disabled — external edits to file nodes don't propagate
`src/renderer/src/hooks/useNodes.ts:275-283`. The `fs.watch`-based watcher
that pushed external file changes into open file nodes is commented out,
because its `onChanged` callback could call `applyNodes` with a stale
`nodesRef.current`, reverting the user's in-flight edits (a classic
read-modify-write race between watcher events and local editing). The
disable is deliberate and documented in the comment, and it is closed at BOTH
ends: `FILE_WATCHER_ENABLED = false` in `src/main/files/watcher.ts:14` gates
the main-process watcher itself (`:37` early-returns), and the renderer-side
application block in `useNodes.ts` is commented out. The underlying race is
unfixed, so today an external edit to a file backing an open node is silently
invisible until reload. Re-enable = flip the flag AND un-comment the hook
block. Fix shape: apply watcher events through the same merge path used for
cross-process updates (compare `updatedAt`, never clobber newer local state)
rather than raw `applyNodes`.

---

**Verification.** Confirmed against source on the working branch
(2026-07-07): disabled block + race explanation at `useNodes.ts:275-283`;
main-process gate at `src/main/files/watcher.ts:14,37`.
Provenance: surfaced by the post-consolidation harness audit; previously the
defect lived only in that code comment, invisible to harness navigation.
