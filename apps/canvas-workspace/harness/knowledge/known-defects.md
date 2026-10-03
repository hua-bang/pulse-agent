# Known Defects

Confirmed-but-unfixed defects in `apps/canvas-workspace` — the intended
behavior is not in question, only the fix is outstanding. Same admission rule
as `packages/engine/harness/knowledge/known-defects.md`: a judgement call
about *what should be true* is a spec question, not a defect; an entry here
has a confirmed cause and an owed fix. Fix one → cover it with a regression
test and delete its entry.

## LIVE (user-visible behavior is degraded today)

### Multi-role conversation runtimes only preserve the final speaker

`conversation-runner.ts` suppresses each segment's persistence, while
`src/main/agent/canvas-agent.ts` returns only its last segment. The keyed runtime
forwards `onRoleTurnEnd` without committing a message per segment; its renderer
hook only updates relay progress. Consequently two successful role-end events
become one persisted assistant message, attributed to the last role. Confirmed
with two local native roles and the real model/IPC path. In addition,
`conversation-service.ts` drops `speakerRole` from its final response, so the
live view lacks attribution that reappears after hydration. Guard segment
boundaries, per-speaker tools/metadata, and final-vs-reloaded output together.

### Streaming text resets the user's tool-section expansion

The effect keyed by `snapshot.messages` in renderer
`useConversationRuntimeStream.ts` rebuilds `collapsedSections` from persisted
tool calls on every text batch. While a later reply streams, opening an older
tool section is undone by the next delta. Reproduced in Electron with a real
completed `bash` operation: the collapsed-section count decreased on click and
returned on the next text event. Hydrate defaults at history/conversation
boundaries and preserve explicit toggles during streaming.

### The delete-session confirmation says Cancel rename

`ChatSessionsRail/ChatSessionRailItem/index.tsx` uses the rename-cancellation
translation key for the delete confirmation's visible button. The action and
accessible label correctly cancel deletion, but the visible copy describes a
different action. Confirmed in the English real-app session menu. Use the
appropriate cancellation label and cover the visible text.

The chat defects above were checked against master on 2026-09-05 using a
disposable Electron profile and a local Responses fixture. A 2026-10-03 recheck
in the packaged full-page chat did not reproduce the tool-section reset, and the
delete confirmation now renders `shell.cancel`; both entries stay until a
regression test covers them (the dock panel was not rechecked). Failed-turn
persistence, renderer reattach, and tool-first input progress were fixed with
regression tests and removed from this list (see `chat-sessions.md`, Turn
recovery). Scope-shared drafts,
image-only conversation titles, and clarification-input labelling also need UX
review; scope-shared drafts currently have explicit scope-draft test coverage,
so a move to per-conversation drafts is a product decision rather than a claimed
regression. Broad Canvas acceptance was green during this audit; it does not
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
