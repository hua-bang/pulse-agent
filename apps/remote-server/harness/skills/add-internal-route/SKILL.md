---
name: add-internal-route
description: Use when adding a route under /internal/* in remote-server. Covers the split auth model (global loopback middleware + per-handler bearer check that is easy to omit) and the active-run-guard decision for any route that runs an agent turn.
---

# Add an Internal Route

An ordered procedure. Two traps: the bearer check is per-handler (not
middleware), and any route that runs an agent turn sits OUTSIDE the
active-run guard unless you opt it in. FACTS live in `src/routes/internal.ts`.

## Steps

1. **Register the handler** on `internalRouter` in `src/routes/internal.ts` (8 handlers exist: worktrees CRUD+run, discord-gateway status/restart, agent/run).

2. **The auth is SPLIT — the middleware only does half.** The global `internalRouter.use('*', ...)` enforces the **loopback** check (`internal.ts:111-117`). The **bearer/`INTERNAL_API_SECRET`** check is a per-handler call to `verifyInternalAuth`/`isAuthorizedInternal` that every existing handler repeats by hand (`internal.ts:121,130,139,148,162,201,229,250`). A new handler that forgets it is loopback-protected but NOT secret-protected — reachable by anything on loopback (including any reverse-proxied request, which all look like loopback). Copy the per-handler check; do not assume the middleware covers you.

3. **If the route runs an agent turn, decide about the active-run guard.** The internal `/agent/run` path does NOT hold the per-`platformKey` active-run guard (`harness/knowledge/known-defects.md §1`, `core-lifecycle.md` invariant 1) — a concurrent internal run + platform run on the same `platformKey` race on one session file with no lock. `/agent/run` mitigates with default `forceNewSession=true` (`internal.ts:264`). If your route can collide on a real `platformKey`, either mint a fresh session or participate in `setActiveRun`/`hasActiveRun` — state which in the PR.

4. **Keep the handler thin.** Delegate to dispatcher/agent-runner/service modules; internal routes are automation entrypoints, not logic homes (AGENTS.md constraint).

5. **Secrets never in source or logs.** The route runs at the same privilege as everything else — a host-tool run it triggers inherits the full secret env (`security-posture.md §1`). Don't echo request bodies or env into responses/logs.

6. **Verify.** `pnpm --filter @pulse-coder/remote-server build` + `test`; smoke from loopback with and without the bearer token to confirm BOTH checks fire (a route that responds without the token has the step-2 bug).

## Done when

The handler carries its own bearer check (not just the global loopback middleware); the active-run-guard interaction is decided and stated; it stays thin; no secret leakage; loopback smoke confirms both auth halves.
