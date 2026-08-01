# Scheduled tasks

Scheduled is a stable top-level app surface — its own route, not a canvas
feature — for persisted, user-defined recurring background work: an exact
next-due main-process timer backed by a 30-minute heartbeat, startup/resume
catch-up, manual run-now, and one isolated durable Agent chat scope per task.
Getting any piece of this wrong either drops a run silently, replays a missed
run more than once, or announces a finished background run in a way that
hijacks the app out from under the user.

Main-process home: `src/main/scheduled/` — `ipc.ts` (the `scheduled:*` IPC
handlers), `runtime.ts` (the service singleton, the unattended-run prompt
wrapper, and `announceRunFinished`), and `scheduled-task-service.ts` (the
`ScheduledTaskService` class: persistence, timers, catch-up, migration,
seeding).

## Cadence and next-run math

Cadence is the `ScheduledSchedule` union in `src/shared/scheduled.ts`:

- `interval` (relative, minimum 30 minutes, anchored at create/enable/
  last-attempt);
- `daily` / `weekly` at a LOCAL wall-clock `HH:mm` (`weekly` also carries
  `weekday: ScheduledWeekday`, 0 = Sunday through 6 = Saturday, matching
  `Date#getDay()`).

`computeNextRunAt` is the single next-run authority for all three kinds —
use local `Date` field arithmetic there, never fixed millisecond offsets, so
absolute slots survive DST.

That "never fixed millisecond offsets" rule is about the two absolute kinds.
Concretely, in the current `src/shared/scheduled.ts`, the `interval` branch
of `computeNextRunAt` still adds a plain millisecond delta
(`from + schedule.intervalMinutes * 60_000`) — correct, because a relative
cadence is meant to drift with execution time and has no wall-clock slot to
preserve. The `daily`/`weekly` branches instead build a `Date` from `from`
and mutate it with field setters (`setHours`, `setDate`), which is what keeps
the run pinned to the same local clock reading across a DST transition
instead of silently sliding by an hour. Do not "simplify" the absolute
branches back to a millisecond-offset computation.

The 30-minute interval floor (and the `HH:mm` shape for `daily`/`weekly`) is
enforced by `normalizeSchedule` in the same file, before a task is created or
updated — from both the Scheduled editor and the chat tools.

Each task's chat runs under its own `AgentScope`:
`{ kind: 'scheduled'; taskId: string }`, one of the three variants defined
alongside the session-store vocabulary in `src/shared/agent-chat.ts` (see
below).

## Catch-up and failed-slot semantics

A slot missed while the app was closed runs ONCE on catch-up and then
realigns to the next slot (never one run per missed slot); failed attempts
consume the current slot rather than hot-looping.

## Migration of `intervalMinutes`

Pre-`schedule` records carrying `intervalMinutes` are lifted into the union
on read (`migratePersistedTask`, in `scheduled-task-service.ts`); the field
is gone from the live contract. `ScheduledTask` itself has no top-level
`intervalMinutes` — cadence lives only under `schedule: ScheduledSchedule`,
whose `interval` variant carries `intervalMinutes`. Any code that still reads
a task's cadence must go through `schedule`, not a legacy top-level field.

## Seeded weekly memory-report task

The built-in weekly memory-report prompt is seeded idempotently as a
disabled Scheduled task on `weekly` Monday 09:00 local; it is no longer an
Experimental entry. Seeding is one-shot by design — an install that already
carries the task keeps its stored schedule, so the Monday default reaches
new installs only. (This is `ensureMemoryReportTask` in
`scheduled-task-service.ts`: it seeds a fixed task id, `memory-report`, so a
second call against an install that already has one is a no-op.)

## Run-finished announcement chain

A finished attempt — success AND failure — is announced by
`announceRunFinished` (`scheduled/runtime.ts`) as a `scheduled:run-finished`
push that `useScheduledRunToasts` turns into a STICKY toast
(`autoCloseMs: 0`). Its action opens the task's conversation in the DOCK's
Pulse AI tab (`useScheduledRunChatOpener` → `dock.openScheduledChat`), the
same surface `Run now` uses — acting on a finished run must never navigate
the whole app onto the AI Chat page and lose what the user was looking at.

Routing to `/chat?scheduledTask=<id>` survives only as the fallback for
views that hide the dock chat tab. `isDockChatTabEnabled`
(`components/RightDock/dock-chat-availability.ts`, full path
`src/renderer/src/components/RightDock/dock-chat-availability.ts`) is the
single predicate behind BOTH that fallback and the dock's `chatTabEnabled`
prop, because a caller that assumes a dock chat tab where there is none
swallows the open silently.

The same module derives `isGlobalChatLauncherVisible` — the floating
Pulse-logo launcher (`RightDock/GlobalChatLauncher.tsx`, full path
`src/renderer/src/components/RightDock/GlobalChatLauncher.tsx`) shows on
every route that has a dock chat tab and no chat chrome of its own, canvas
being the one exception. Deriving it (rather than an independent route list)
stopped the Scheduled page from being hand-excluded with no way to reach the
agent — guarded by
`src/renderer/src/components/RightDock/__tests__/dock-chat-availability.test.ts`.

## Session-store vocabulary

Each task's chat is a session STORE (`__scheduled__-<taskId>`), listed in
that rail beside workspaces and global chat. `src/shared/agent-chat.ts` owns
the store-id vocabulary — `scopeSessionStoreId`, `scheduledTaskIdFromStoreId`,
`isListableSessionStore` — and every consumer that maps a listed session back
to a scope MUST go through it: a sentinel store id treated as a workspace id
activates an agent against a workspace that does not exist.

`__`-prefixed stores are allowlisted, never blanket-skipped (that is what hid
scheduled chats from the rail).

## The removed OS notification (must not return)

Deliberately in-app only: OS `Notification` was tried and removed (Focus
modes, missing notification daemons, unsigned dev builds, and
Windows-without-AppUserModelID all drop it silently, and it needed a
retained-reference dance to survive GC), so do not reintroduce a second
channel — `scheduled-run-notify.test.ts`
(`src/main/__tests__/scheduled-run-notify.test.ts`) asserts none is raised.

A run finishes while nobody is watching, so the toast must never expire on a
timer (`useScheduledRunToasts` sets `autoCloseMs: 0` for exactly this
reason).

## IPC contract and UI rules

IPC contract: `src/shared/scheduled.ts` → `src/preload/bridge/scheduled.ts`
→ renderer `components/Scheduled/` (full path
`src/renderer/src/components/Scheduled/`).

UI rules for that renderer surface:

- List rows are presentational — every action is an explicit button. (The
  row used to be one big button, so a stray click on the title or the
  cadence text opened a chat; the current layout and the reasoning are in
  `src/renderer/src/components/Scheduled/ScheduledPage.tsx`.)
- The time picker is hour/minute `ui/Select`s, never a native
  `<input type="time">`
  (`src/renderer/src/components/Scheduled/TimeOfDaySelect.tsx`).

## Chat tool entry and the module-cycle note

Chat entry: `scheduled_task_list` / `scheduled_task_create` /
`scheduled_task_update` in `src/main/agent/tools/scheduled.ts` — app-level,
so registered UNWRAPPED on both tool factories (`createGlobalCanvasTools()`
and `createCanvasTools(workspaceId)` in `src/main/agent/tools/index.ts`),
all `defer_loading`, no delete (see `harness/knowledge/security-posture.md`
for why).

It dynamic-imports `scheduled/runtime`
(`await import('../../scheduled/runtime')`) to avoid the
tools→runtime→agent-service module cycle: `runtime.ts` reaches back into the
agent service, so importing it eagerly at module load would close a cycle
through `tools/index → runtime → agent/ipc → service → tools/index`.

## Evidence

Bound tests:

- `src/shared/scheduled.test.ts` — schedule validation + next-run math
- `src/main/__tests__/scheduled-task-service.test.ts`
- `src/main/__tests__/scheduled-run-notify.test.ts` — completion push,
  success AND failure, and no OS notification
- `src/renderer/src/components/Scheduled/__tests__/useScheduledRunToasts.test.tsx`
  — sticky toast
- `src/renderer/src/components/Scheduled/__tests__/scheduledChatTarget.test.ts`
  — dock-by-default vs route fallback
- `src/main/agent/__tests__/scheduled-tools.test.ts`
- `src/renderer/src/components/Scheduled/__tests__/TaskEditorModal.test.tsx`
- `src/renderer/src/components/Scheduled/__tests__/ScheduledPage.test.tsx`
- `src/main/agent/__tests__/service-history.test.ts` — scheduled-scope
  coverage, alongside its main subject
- `src/renderer/src/components/RightDock/__tests__/dock-chat-availability.test.ts`
