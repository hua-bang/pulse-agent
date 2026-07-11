# Known Defects — apps/remote-server

Confirmed-but-unfixed defects with reproducible evidence. Ranked by
confidence/severity. From the 2026-07-11 two-scanner + hand-verified pass.
Style bugs and speculation are excluded — every entry cites the line and a
concrete failure. Fixing any of these needs a regression test (the whole
lifecycle layer currently has zero coverage — see §Test).

The RCE-class Feishu finding lives in `security-posture.md §1`, not here —
it is a posture fact recorded by owner decision, not a defect queued for
fix.

## 1. Internal `/agent/run` bypasses the per-platformKey active-run guard — MED

`routes/internal.ts` never calls `setActiveRun`/`hasActiveRun` (the guard
lives only in `dispatcher.ts`/`active-run-store.ts`). A concurrent internal
run and a platform run on the SAME `platformKey` do unguarded
read-modify-write on one session file (`session-store.ts:277-292`:
read → mutate → write, no lock) → lost update. Default `forceNewSession=true`
(`internal.ts:264`) mitigates by minting a fresh session; a caller passing a
colliding `platformKey` with `forceNewSession:false` triggers it.

## 2. `/api/devtools/*` unauthenticated with wildcard CORS — HIGH (data exposure)

`app.use('/api/devtools/*', cors({ origin: '*' }))` (`server.ts:21`) and no
bearer/loopback check on any route in `routes/devtools.ts` (grep: zero auth
calls). On the default `HOST=0.0.0.0` this exposes cross-session token/cost
stats and full LLM prompt snapshots (`getLlmPromptSnapshot`) — potential
secret/PII leak — to any reachable client. See `security-posture.md §3`.

## 3. Clarification consumes the user's next message even if it is a command — MED

While a clarification is pending, the next inbound text is submitted as the
answer and the message returns `null` (feishu `adapter.ts:220-236`;
same shape in discord/telegram). A user typing `/stop` mid-clarification has
it swallowed as the answer instead of executed — the run they wanted to
stop keeps going.

## 4. Discord slash-command runs cannot be cancelled by the `❌` reaction — MED

The cancel token is registered only on the channel/gateway path
(`adapters/discord/adapter.ts:300-302`), not the interaction path
(`:262-273`); the reaction handler silently no-ops for interaction runs
(`gateway.ts:427-429`). Only `/stop` cancels a slash-command run. A user who
reacts `❌` expecting cancellation gets none.

## 5. Mid-run session commands orphan or redirect the in-flight run — MED

`fork`, `wt`, and other members of `COMMANDS_ALLOWED_WHILE_RUNNING`
(`command-defs.ts`) mutate shared state a running turn reads:
- `/fork` reassigns `sessionStore.index[platformKey]` to a new session id
  while the old turn is still in flight; the turn saves correctly to its own
  (now orphaned) file, but the user is moved off the session the running
  turn will complete into — the final answer lands where the UI no longer
  shows as current.
- `/wt` rebinds the worktree for `scopeKey=platformKey`, read live per tool
  call (`worktree/integration.ts`, `worktree/commands.ts`), not snapshotted
  at turn start — a concurrent rebind redirects where subsequent
  `worktree_run` calls in the SAME active run execute.

## 6. `TelegramAdapter` throws at module load if `TELEGRAM_BOT_TOKEN` unset — MED (latent)

`export const telegramAdapter = new TelegramAdapter()`
(`adapters/telegram/adapter.ts:145`) runs the constructor, which calls
`createTelegramClient()` that throws when the token is missing
(`:22-24`). Un-commenting `telegramRouter` in `server.ts` to mount Telegram
would crash the import on any box without the token set. Latent only because
Telegram is currently unmounted.

## 7. Low-severity residue

- `INTERNAL_API_SECRET` compared with `===`, not `timingSafeEqual`
  (`internal.ts:430-435`) — mitigated by loopback-only exposure.
- Discord ED25519 verify has no timestamp-staleness check
  (`adapter.ts:110-138`) — replay bounded only by Discord's signing window.
- Dead code: `truncateForNotify()` (`internal.ts:658`) is never called.
- Stray `console.log('modelType', modelType)` in every non-ACP turn's hot
  path (`agent-runner.ts:382`).
- Session-store read-modify-write has no locking on `save`,
  `setLatestAttachments`, `linkSession`, `clearCurrent`, `/compact` save —
  safe only while the dispatcher guard serializes a key (which §1 and
  `/compact` partly sit outside).

## Resolved (do not re-report)

- **ProxyAgent cache-key bug — FIXED** (`core/proxy.ts:21-24`, commit
  `7e27500`). The cache once stored the normalized URL but compared the raw
  env value, so it never hit and built a new agent per download. Now keyed
  by the raw env value with an explaining comment. Root `AGENTS.md §6`
  records the incident; regression coverage is indirect via
  `core/attachments.test.ts`. This is the "orphaned tests" precedent — do
  not confuse the fixed bug with an open one.

## Test coverage reality

Six Vitest files, all pure-helper unit tests (`model-config`, `attachments`,
`analyze-image`, three Feishu parsers). **Zero** automated coverage for the
`core-lifecycle.md` invariants: the active-run guard, cancellation,
clarification timeout/consume, session fork/link/`canAccessSession`,
internal-route auth, and every `verifyRequest` (so the Feishu no-op in
`security-posture.md §1` has no regression test that would catch a
reintroduction). New work touching these paths should add the first real
lifecycle test alongside it.
