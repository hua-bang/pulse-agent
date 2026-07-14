# Core Lifecycle — apps/remote-server

The webhook→answer path and the invariants that hold it together. Read this
before touching `dispatcher.ts`, `active-run-store.ts`,
`clarification-queue.ts`, `agent-runner.ts`, or `session-store.ts`. Traced
and proven 2026-07-11; invariants cite the line that enforces them.

## End-to-end trace (platform webhook)

```
POST /webhooks/<platform>
  → adapter.verifyRequest()          # ingress gate (Discord: ED25519; Feishu: NO-OP — see security-posture.md)
  → adapter.parseIncoming()          # → IncomingMessage{ platformKey, streamId, text, ... }
  → adapter.ackRequest()             # immediate 200/202 (platforms require a fast ack)
  → dispatchIncoming()  [FIRE-AND-FORGET — .catch() only logs]
      → runAgentAsync (dispatcher.ts:62)
          → processIncomingCommand()             # slash commands (chat-commands.ts)
          → hasActiveRun(platformKey)            # ← concurrency guard (dispatcher.ts:119)
          → setActiveRun(platformKey, ...)       # (dispatcher.ts:129)
          → adapter.createStreamHandle()
          → executeAgentTurn (agent-runner.ts:298)
              → sessionStore.getOrCreate()       # ~/.pulse-coder/remote-sessions/
              → runWithAgentContexts()           # worktree → vault → memory contexts
              → engine.run() / runAcp()          # streaming callbacks → StreamHandle
              → sessionStore.save()
          → finally clearActiveRunIfMatches(platformKey, streamId)   # (dispatcher.ts:215)
```

**Feishu is the exception to this shape.** `routes/feishu.ts:16-48` is a
bespoke inline flow (long-connection short-circuit + `handleCardActionBody`)
that does NOT call the generic `dispatcher.dispatch()`. The CLAUDE.md
lifecycle diagram is accurate for Discord, stale for Feishu.

## Load-bearing invariants (each with its enforcing line)

1. **Per-`platformKey` serialization is atomic and dispatcher-only.**
   `hasActiveRun` (`dispatcher.ts:119`) and `setActiveRun`
   (`dispatcher.ts:129`) have NO `await` between them, so on Node's single
   thread the check-and-set cannot interleave — a second concurrent message
   for the same key is rejected. The store is a plain
   `Map<string, ActiveRun>` (`active-run-store.ts`), single-process, no
   lock. **This guard lives ONLY in `dispatcher.ts`**; the internal
   `/agent/run` path does not hold it (see `known-defects.md` §1).
2. **Stale-`finally` guard.** `clearActiveRunIfMatches` clears only when
   `run.streamId === streamId` (`active-run-store.ts:27-36`), so a slow
   aborted run's `finally` cannot clear a newer run started after `/stop`.
3. **Cancellation.** Each `ActiveRun` owns an `AbortController`
   (`types.ts:100-105`) threaded into `engine.run`/`runAcp`. Two abort
   sources: `/stop` and aliases (allowed while running via
   `command-defs.ts` `COMMANDS_ALLOWED_WHILE_RUNNING`) →
   `abortAndClearActiveRun`; and Discord `❌` reaction → reverse index
   `cancelTokenToPlatformKey`. The reaction token is registered **only for
   channel/gateway messages, not for interaction (slash-command) runs**
   (`adapters/discord/adapter.ts:300-302` vs `:262-273`) — so slash-command
   runs are `/stop`-cancellable only (`known-defects.md` §4).
4. **Clarification queue.** A single in-memory `Map<streamId, PendingEntry>`
   (`clarification-queue.ts`); a request parks a promise with a `setTimeout`
   fallback to `defaultAnswer` or rejection; the **next inbound message**
   for that platformKey is consumed as the answer (matched via
   `getActiveStreamId` + `hasPending` in each adapter), and run failure
   cancels the pending entry (`dispatcher.ts:195`). Consequence: a `/stop`
   typed mid-clarification is swallowed as the answer, not executed
   (`known-defects.md` §3).
5. **Session isolation vs. sharing.** One shared `Engine`
   (`engine-singleton.ts:59`); each run gets its own `context` object, so
   concurrent different-key runs are isolated. The only shared mutable
   persistence is the per-session file, and `save` captures the `sessionId`
   at turn start — so a mid-run `/fork` or `/new` cannot corrupt the
   in-flight run's own file, but it detaches the result from what the user
   now sees as current (`known-defects.md` §5).

## The active-run guard is the spine

Most correctness here rests on invariant 1. Any new path that runs an agent
turn (a new internal route, a new command that executes while running, a
second ingress) MUST decide consciously whether it participates in the
per-`platformKey` guard. The known defects in `known-defects.md` are almost
all "a path that sits outside the guard": internal `/agent/run` (§1),
`COMMANDS_ALLOWED_WHILE_RUNNING` members that mutate session state (§5).
Treat "does this hold the active-run guard?" as the first question for any
lifecycle change.
