# Known Defects

Confirmed-but-unfixed defects in `apps/canvas-workspace` — the intended
behavior is not in question, only the fix is outstanding. Same admission rule
as `packages/engine/harness/knowledge/known-defects.md`: a judgement call
about *what should be true* is a spec question, not a defect; an entry here
has a confirmed cause and an owed fix. Fix one → cover it with a regression
test and delete its entry.

## LIVE (user-visible behavior is degraded today)

Fixed with regression tests and removed from this list: failed-turn
persistence, renderer reattach, tool-first input progress (see
`chat-sessions.md`, Turn recovery), and, on 2026-11-15, multi-role turns that
kept only the final speaker, streaming text that reset opened tool sections,
and the delete-session confirmation's cancel copy. Scope-shared drafts,
image-only conversation titles, and clarification-input labelling also need UX
review; scope-shared drafts currently have explicit scope-draft test coverage,
so a move to per-conversation drafts is a product decision rather than a
claimed regression. Broad Canvas acceptance was green during this audit; it does not
prove these missing interaction paths.

### External file edits: preserve the replacement synchronization path

The old blanket `FILE_WATCHER_ENABLED` path remains disabled: applying its events
directly to a captured canvas array could revert a newer local edit. Do not
re-enable it by uncommenting the old hook.

SQLite workspaces now use `canvas/sync/markdown-index.ts` to observe parent
directories (including atomic-renamed files), update clean indexes, and retain
dirty drafts. `FileNodeBody/useFilePersistence.ts` also refreshes on focus and
file-change notifications, checks the read version when saving, and retains the
draft on conflict. These paths are covered by the colocated index, persistence,
and editor tests. External editors still do not participate in a shared filesystem
transaction; file version checks are optimistic. See `main-domain-modules.md`
and `node-detail.md` for the maintained storage and editor contracts.
