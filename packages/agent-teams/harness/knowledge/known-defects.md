# Known Defects — packages/agent-teams

Confirmed-but-unfixed defects with reproducible evidence, from the
two-scanner (sonnet+opus) + hand-verified pass 2026-07-11. Both scanners
converged on the top items independently; the review-gate bypass and the
event-emit orphans were hand-verified. Ranked by severity. Fixing any needs
a regression test — note the classic execution loop has ZERO behavioral
coverage (§Test).

## 1. Review gate silently bypassed when the lead has no live session — HIGH

`submitTaskCompletion`'s `requiresAcceptance` is
`submitter.role==='teammate' && !!lead?.sessionRef && !!this.agentSessions`
(`src/runtime/team-runtime.ts:798-803`). When the lead has no `sessionRef`
(never launched / session died) or no `agentSessions` adapter is configured,
a teammate's completion falls through to `completeTask → done`, unblocking
dependents with NO review. This directly contradicts the documented
invariant ("completion should mean deliverable evidence, not an agent
claim", `docs/contracts.md`) and the roadmap North Star. Every one of the
~1974 runtime test lines asserts the gate WITH a live lead session, so the
bypass branch is real and completely uncovered.

## 2. Classic broadcast messages re-delivered forever — HIGH

`Mailbox.readUnread` returns `_broadcast` entries filtered only by
`from`/`read`, but broadcasts are NEVER written back as read — only the
per-recipient inbox is marked (`src/mailbox.ts:56-71`). Every
`teammate.run()` re-injects the same broadcast (`teammate.ts:117`);
`unreadCount` ignores broadcasts entirely (`mailbox.ts:83-86`), so it
disagrees with `readUnread`. Currently unreachable through documented APIs
(`TeamLead.broadcast` fans out per-recipient `send()` calls, never `to:'*'`)
— a real bug in dead code, but the `to:'*'` path is a loaded gun for anyone
who uses `Mailbox.send(from, '*', ...)` directly.

## 3. Shutdown mid-task force-completes instead of failing (classic) — HIGH

`Teammate.run()` swallows `AbortError` and returns normally with partial
output (`teammate.ts:155-159`); `Team.runTeammateLoop` then unconditionally
auto-completes the still-`in_progress` task with that output
(`team.ts:429-433`) — even though the run was aborted precisely because a
shutdown was requested. An interrupted task is recorded as `completed`, not
failed or requeued. Zero coverage.

## 4. Runtime `emit()` has no per-handler exception guard — MED

`for (const handler of this.handlers) handler(event)` (`team-runtime.ts:2116-2133`)
is unguarded; a throwing `onEvent` subscriber propagates into whatever
mutator emitted (createTask/completeTask/…), aborting it mid-operation. The
classic `Team.emit` wraps each handler in try/catch (`team.ts:533-541`); the
runtime does not — inconsistent, and the runtime is the surface hosts
subscribe to.

## 5. Floating rejection on session events — MED

The constructor subscribes with `void this.handleAgentSessionEvent(event)`
(`team-runtime.ts:260-262`); the handler is async and writes to the store. A
store failure yields a voided rejection — the session event (idle/completed/
failed → task review) is silently dropped, potentially stranding a task in
`in_progress` with no watchdog signal.

## 6. Classic file lock abandons mutual exclusion under contention — MED

After 50×20ms retries, `TaskList.withLock` force-unlinks the lock and runs
`fn()` WITHOUT holding it (`task-list.ts:324-326`). Two processes both past
the timeout can double-claim / lost-update `tasks.json`. Narrow window
(>1s sustained contention).

## 7. `execSync` blocking I/O in the classic teammate bash override — MED

The cwd-wrapper replaces the engine's async bash with a synchronous
`execSync` (`teammate.ts:271-289`) — the exact blocking-I/O failure mode
root `AGENTS.md §6` codified a guard against. Safe for CLI hosts; a latent
freeze if the classic surface is ever embedded in a GUI thread.

## 8. Transition-guard asymmetry (runtime) — MED

`completeTask`/`failTask`/`blockTask` have NO early-return guard against
acting on an already `done`/`failed` task, whereas `submitTaskCompletion`/
`requestTaskReview`/`cancelTask` DO (`team-runtime.ts:791,912,1017`). The
suite proves the guard matters and is enforced for `cancelTask`
(`runtime/__tests__/team-runtime.test.ts:1627-1630`) but has no equivalent
for `blockTask`/`failTask` — a stale/duplicate/race call could revert a
finished task to `blocked`/`failed` and re-trigger `parkDependentsOnFailure`
on a completed task's dependents.

## 9. Paused human gates cancelled but never restored — LOW-MED

`pauseTeam` sets open gates to `cancelled` (`team-runtime.ts:447-452`);
`resumeTeam` restores agents/tasks but NOT gates (`:458-506`). A teammate
mid-question loses it across pause/resume; recovery relies on the agent
re-asking.

## Drift the parity tool now guards (fixed docs, not code)

- `docs/contracts.md` listed `packages/engine` as a consumer — FALSE (it's
  an orchestrator-based tool sharing the name; zero `pulse-coder-agent-teams`
  imports in `packages/engine/src`). It also omitted the real consumer
  `packages/cli`. Both corrected 2026-07-11; `describe-agent-teams.mjs`
  now hard-errors on a listed non-consumer.
- 3 runtime events are declared but never emitted (`agent_status_changed`,
  `runtime_error`, `task_started`) — dead protocol surface a host could
  wait on. Recorded in the tool's allowlist; hosts should not subscribe to
  them expecting delivery.
- README referenced a non-existent `harness/skills/contract-coding.md` —
  corrected to point at the real knowledge/tool.

## Test coverage reality

7 test files, genuinely wired and run (`vitest run --passWithNoTests`, no
config, default glob — NOT the remote-server orphaned-tests failure mode).
`runtime/__tests__/team-runtime.test.ts` (~1974 lines) is strong: dispatch,
scope defer/release, dependency context, round checkpoints, pause/resume,
human gates, revision loop, duplicate-submission dedupe, verification/handoff
threading. **Zero coverage** for: the no-lead-session review bypass (§1),
the classic `Team.run()` execution loop end-to-end (§3 — no test calls
`team.run()` to completion, so the loop / concurrency pool / auto-complete-
on-idle / shutdown behavior is untested), `emit()` handler-throw (§4), and
`blockTask`/`failTask` on a settled task (§8). New work touching these
paths should land the first covering test.
