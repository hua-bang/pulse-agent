---
name: add-task-metadata-key
description: Use when adding a shared task-metadata key to the agent-teams runtime (like round/scope/verify). This is the highest-synchrony surface in the package — one key touches the const, a typed reader, the public export, two docs, and every host that reads it. Miss one and a host breaks silently.
---

# Add a Task-Metadata Key (runtime)

An ordered procedure. The hazard is that a metadata key is a cross-package
contract spread across ~6 places with no compile-time link between them.
FACTS live in the cited files.

## Steps

1. **Snapshot first.** `node harness/tools/describe-agent-teams.mjs` — and
   read `TASK_METADATA_KEYS` (`src/runtime/team-runtime.ts:102-108`, 5 keys
   today) plus the sibling `read*` accessors to match their shape.

2. **Add the key constant** next to the existing `TASK_*_METADATA_KEY`
   consts and register it in the `TASK_METADATA_KEYS` object.

3. **Add a typed reader** (`readTaskYourKey(task)`) mirroring
   `readTaskRound`/`readTaskScope` — hosts read metadata through these, not
   by reaching into the raw `metadata` bag. If the key controls dispatch
   (like `scope`/`round`), also wire it into `dispatchReadyTasks`'s gating.

4. **Export it** from `src/runtime/index.ts` — an accessor defined but not
   re-exported is invisible to hosts (the package already carries one such
   dead-but-defined symbol; don't add another).

5. **Update BOTH docs in the same change**: `docs/contracts.md` (the
   metadata contract) and `AGENTS.md`'s `TASK_METADATA_KEYS` line. The doc
   is the only registry hosts can discover the key from — an undocumented
   shared key is a silent host-visible surface (several already exist:
   `currentRound`, `proposedResult`, `completionSubmittedBy`, `revisionNote`,
   `teamPause` — do not add a sixth).

6. **Update the host reader(s).** `apps/canvas-workspace/src/main/agent-teams/service.ts`
   is the runtime host; it reads metadata keys directly. A key the host
   doesn't read does nothing user-visible. Confirm which host(s) need it.

7. **Verify.** `describe-agent-teams.mjs` clean; `pnpm --filter
   pulse-coder-agent-teams test`; if the key gates dispatch, add a
   `team-runtime.test.ts` case (that suite already tests scope/round gating —
   follow its pattern).

## Done when

The const, the typed reader, the `runtime/index.ts` export, both docs, and
every consuming host are updated together; dispatch gating is wired if the
key controls readiness; describe-agent-teams clean; test green.
