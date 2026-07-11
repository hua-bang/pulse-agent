# Core Lifecycle — packages/agent-teams

How a task moves from creation to done, across the TWO coordination surfaces
this package ships, and the invariants that hold each together. Read before
touching `src/runtime/team-runtime.ts` or the classic `src/team.ts` /
`task-list.ts` / `teammate.ts`. Traced by two independent scanners +
hand-verified 2026-07-11; invariants cite the enforcing line.

## Two surfaces — know which one you are in

| | Classic (`src/*.ts`) | Runtime (`src/runtime/*`) |
|---|---|---|
| Owns | the `Engine` instances + the in-process execution loop | protocol STATE only; the host drives sessions |
| State machine | `pending → in_progress → completed\|failed` (`types.ts:68`) | `todo → in_progress → {needs_input\|needs_review\|blocked} → done\|failed` (`runtime/types.ts`) |
| Review gate | none — completion is prompt-trust | `needs_review`, lead-accepted (see below) |
| Scope / rounds / human gates | none | all present |
| Host must supply | nothing (package owns Engines + loop) | a `TeamRuntimeStore` + an `AgentSessionAdapter` (`runtime/types.ts:215-228`) |
| Consumers | `apps/teams-cli`, `packages/cli` | `apps/canvas-workspace` |

The two surfaces share NO code — they independently reimplement task
records, dependency readiness, mailbox, and event unions with **same-named,
incompatible** types (`TaskStatus`/`TeamStatus`/`TeamEventType` differ
between `types.ts` and `runtime/types.ts`). **The runtime is the forward
direction** (the maturity roadmap `../../docs/07-agent-teams-maturity-roadmap.md`
lists "converge the three multi-agent implementations" as debt; every newer
protocol concept lives only in the runtime). When you extend "the task
state machine," know which surface you're in — a change to one never
implies the other.

## Runtime lifecycle + proven invariants (the keystone)

1. **Create → `todo`**, stamped with `round` metadata, graph acyclicity
   asserted (`team-runtime.ts:355-368`).
2. **Dispatch `todo → in_progress`** is the ONLY start path
   (`dispatchReadyTasks`), and it is triple-gated: dependency readiness
   (`isTaskReady` requires EVERY dep `=== 'done'` — a failed dep can never
   satisfy it, `:1606-1608`); file-scope non-overlap with any task that
   `holdsScope` (`:632-661`, `scopesOverlap`/`normalizeScopeEntry`
   `:137-155`); and, when round metadata is enabled, same-round only
   (`:616-622`). The prompt is delivered to the session BEFORE the
   assignment is committed, so a delivery failure leaves the task `todo`
   (`:688-712`).
3. **THE HEADLINE INVARIANT (and its hole): a teammate cannot mark its own
   task done.** `submitTaskCompletion` parks a teammate's completion in
   `needs_review` and notifies the lead; only the lead/human/runtime path
   calls `completeTask` directly. BUT this is CONDITIONAL:
   `requiresAcceptance = submitter.role==='teammate' && !!lead?.sessionRef
   && !!this.agentSessions` (`:798-803`). If the lead has no live session or
   no adapter is configured, a teammate's completion falls straight through
   to `completeTask → done` with NO review — see `known-defects.md §1`. Do
   not rely on the review gate being unconditional.
4. **`completeTask → done`** then re-queues dependents that were parked on a
   now-satisfiable failed dep, or re-parks them on another still-failed dep
   (`:851-908`).
5. **Failure parks dependents, doesn't fail them.** `failTask`/`cancelTask`
   set `parkDependentsOnFailure` → todo dependents become `blocked` with
   `blockedByFailedDep` metadata (`:944-1050`). They never auto-recover; a
   human/lead must intervene.
6. **Round checkpoints** are an enforced gate: `checkRoundCompletion` flips
   the team to `round_checkpoint` when all current-round tasks are terminal
   (`:1753-1777`); `advanceRound`/`finalizeFromCheckpoint` are legal ONLY
   from that state (throw otherwise, `:514-518`).
7. **Human gates** set task+agent `needs_input` (`:1122-1138`); answering
   restores `in_progress`/`idle` and pushes the answer into the session
   (`:1178-1222`); a gate on an already-finished task records `cancelled`
   and suppresses notifications (`:1096`).
8. **Revision loop**: a message to a teammate's `needs_review` task is a
   send-back — a FREE teammate resumes immediately; a BUSY one has the task
   returned to `todo` pinned to it with a `revisionNote` delivered in the
   next dispatch prompt (never interleaved into a live session, `:1240-1302`).

## Classic lifecycle (the older, self-contained surface)

`Team.run()` owns the loop: spawn teammates, process mailbox, wait on
plan-mode approval, run a concurrency pool, bound each `Teammate.run()` by a
wall-clock `timeoutMs` + `maxIdleWaits` (`team.ts:218-383`). Claim is
lock-guarded with work-stealing only from INACTIVE teammates
(`task-list.ts:81-134`). Two sharp edges live here: a shutdown mid-task
force-COMPLETES the in-progress task with partial output instead of failing
it (`teammate.ts:155-159` swallows `AbortError` → `team.ts:429-433`
auto-completes), and the file lock ABANDONS mutual exclusion after sustained
contention (`task-list.ts:324-326`). Both in `known-defects.md`.

## The rule of thumb

Most correctness rests on WHO may transition a task and WHETHER a path
holds the gate it should. `TeamRuntime` does NOT enforce actor permissions
internally — `completeTask`/`failTask`/`blockTask` take an `actor` only for
attribution, never to gate the call (`:851,968,1052`); "only the lead
accepts" is structural (hosts wire the right CLI verb to the right caller),
not mechanical. So for any lifecycle change, ask first: **does this path
hold the review gate / scope guard / round gate it should, and can a
teammate reach a mutator it shouldn't?**
