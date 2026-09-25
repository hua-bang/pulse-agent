# Known Defects

Confirmed-but-unfixed defects in `apps/canvas-workspace` — the intended
behavior is not in question, only the fix is outstanding. Same admission rule
as `packages/engine/harness/knowledge/known-defects.md`: a judgement call
about *what should be true* is a spec question, not a defect; an entry here
has a confirmed cause and an owed fix. Fix one → cover it with a regression
test and delete its entry.

## LIVE (user-visible behavior is degraded today)

### Keyed failed-turn persistence loses recovery metadata and executed tools

`src/main/agent/conversation-runtime/conversation-runner.ts` disables the rich
legacy `appendRunMessages` callback. In `conversation-runtime.ts`, the catch
path only records `turnStatus` and an in-memory error; the assistant's tool list
is assigned only after a successful runner result. The saved failed message
therefore lacks tool calls, error details, failure kind, and retryability.
Stopped messages also omit retryability. The renderer synthesizes these fields
while live, making reload inconsistent: a completed `bash` tool followed by a
provider error shows the tool and Try again initially, then only Response failed
after reload. Settle and preserve terminal tools/metadata on the keyed path;
legacy `chat-failure-persistence.test.ts` coverage alone does not exercise it.

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

### Renderer reload cannot reattach to an active keyed conversation

The renderer `conversationStore.ts` starts with `loading: false`, and
`useConversationRuntimeStream.ts` installs IPC listeners only inside
`sendMessage`. Initial hydration reads persisted history without the main
runtime's live snapshot or a subscription to its active run. Reproduced by
reloading the renderer during a slow reply: main's running-session query still
returns the session, but the UI loses the partial reply and Stop button and
does not display the eventual completion. This concerns renderer reload, not
ordinary rail switching, which was verified to retain the stream. Recovery
requires a keyed snapshot/subscription handshake, including pending questions.

### Streaming text resets the user's tool-section expansion

The effect keyed by `snapshot.messages` in renderer
`useConversationRuntimeStream.ts` rebuilds `collapsedSections` from persisted
tool calls on every text batch. While a later reply streams, opening an older
tool section is undone by the next delta. Reproduced in Electron with a real
completed `bash` operation: the collapsed-section count decreased on click and
returned on the next text event. Hydrate defaults at history/conversation
boundaries and preserve explicit toggles during streaming.

### Tool-input progress is invisible until an assistant row exists

Renderer `useConversationRuntimeStream.ts` forwards tool-input events into the
streaming-tools store but does not call `ensureAssistant` on input start.
`ChatMessages` gives its pending placeholder no tools, so a tool-first response
shows only Working throughout argument generation. Confirmed with a valid
Responses tool stream: input-start/deltas reached the renderer before the real
`bash` call, but the UI had no tool name or disclosure until execution. Mount
the assistant at the first tool-input event and test the rendered pending state.

### The delete-session confirmation says Cancel rename

`ChatSessionsRail/ChatSessionRailItem/index.tsx` uses the rename-cancellation
translation key for the delete confirmation's visible button. The action and
accessible label correctly cancel deletion, but the visible copy describes a
different action. Confirmed in the English real-app session menu. Use the
appropriate cancellation label and cover the visible text.

The chat defects above were checked against master on 2026-09-05 using a
disposable Electron profile and a local Responses fixture. Scope-shared drafts,
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
