# Known Defects

Confirmed-but-unfixed defects in `apps/canvas-workspace` — the intended
behavior is not in question, only the fix is outstanding. Same admission rule
as `packages/engine/harness/knowledge/known-defects.md`: a judgement call
about *what should be true* is a spec question, not a defect; an entry here
has a confirmed cause and an owed fix. Fix one → cover it with a regression
test and delete its entry.

## LIVE (user-visible behavior is degraded today)

### 13 phantom design tokens — referenced but defined nowhere
The renderer references 13 custom properties via `var(--x)` that have no
definition anywhere (no `--x:` in CSS, no quoted `'--x'` in TS/TSX):
`--accent-muted`, `--accent-soft`, `--accent-soft-strong`,
`--border-subtle`, `--frame-bg-alpha`, `--frame-title-gap`, `--note-paper`,
`--surface-1`, `--surface-2`, `--surface-alt`, `--surface-subtle`,
`--text-primary`, `--text-tertiary`. Each renders as its fallback where one
exists, or the property's initial/inherited value where none does — even
`AppShellProvider` (the shared toast/confirm primitive) colors text via the
nonexistent `--text-primary`. Guard: the phantom-token check in
`src/main/__tests__/ui-reuse-governance.test.ts` baselines these 13
(shrink-only, stale entries flagged) and fails on any NEW phantom. Fix
shape: define each token in `styles.css` `:root` or repoint references at
existing tokens. (A 14th, `--radius-md`, was fixed 2026-07-07 — defined as
8px — with the same check as its regression guard.)

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
