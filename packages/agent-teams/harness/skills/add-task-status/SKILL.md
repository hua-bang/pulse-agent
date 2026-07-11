---
name: add-task-status
description: Use when adding a value to a task/team/agent status union in agent-teams. The landmine is that there is NO exhaustiveness guard anywhere, so a new status silently falls through dispatch gating, readiness, scope-holding, and every status filter — and you must first know WHICH surface's state machine you are extending.
---

# Add a Task/Team/Agent Status Value

An ordered procedure. Two hazards: the classic and runtime surfaces have
SEPARATE, incompatible status unions, and neither has a `never`/exhaustive
switch, so a new value fails open (silently skipped) rather than failing to
compile.

## Steps

1. **Decide which surface.** `src/types.ts` (classic:
   `pending→in_progress→completed|failed`) and `src/runtime/types.ts`
   (runtime: 7-state) are different type families with the same names. A
   value added to one does NOTHING for the other. Read
   `harness/knowledge/core-lifecycle.md` "Two surfaces" first. Most new
   protocol work is runtime.

2. **Add the union member** (`TaskStatus`/`TeamStatus`/`AgentStatus` in the
   chosen `types.ts`).

3. **Audit every place that branches on the union — there is NO compiler
   help.** For a runtime `TaskStatus` value, walk at minimum:
   - `isTaskReady` (`runtime/team-runtime.ts:1606-1608`) — is a task in the
     new status a dependency that should block dependents?
   - `holdsScope` (`:632-634`) — does the new status hold a file scope?
   - `dispatchReadyTasks` gating (`:602-773`) — can a task in this status be
     dispatched, and does it filter it out where it should?
   - the terminal-state checks (`done`/`failed` early-returns in
     `completeTask`/`cancelTask`/`checkRoundCompletion` `:1753-1777`) — is
     the new status terminal? round-completion counts terminal tasks.
   - every `.filter(t => t.status === ...)` / `status !== 'done'` site.
   A miss here is the classic silent-fallthrough bug: the task just never
   gets picked up, or gets picked up when it shouldn't, with no error.

4. **Transition guards.** If the status is terminal, add it to the
   `done`/`failed` early-return guards — and note the existing asymmetry
   (`known-defects.md §8`): `blockTask`/`failTask` currently lack those
   guards. Don't copy the gap.

5. **Host rendering.** The runtime host (canvas-workspace) renders status;
   an unrendered status shows as unknown/blank. Update the host mapping.

6. **Update docs + tests.** Reflect the new state in
   `docs/contracts.md`/`core-lifecycle.md`; add a `team-runtime.test.ts`
   case exercising its dispatch/readiness behavior (the suite tests state
   transitions richly — follow its fake-clock + store pattern).

## Done when

The union member exists on the correct surface; every readiness/scope/
dispatch/terminal branch has been consciously audited (not assumed); the
host renders it; docs and a transition test land with it.
