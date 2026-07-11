# Security Posture — apps/remote-server

What an agent run and an inbound request can reach in this workspace, and
where the trust boundaries actually are (as opposed to where the docs say
they are). Written from a two-scanner + hand-verified evidence pass
(2026-07-11). Every claim below is cited to `file:line` and was confirmed in
source, not inferred.

> This file DOCUMENTS posture; it does not fix it. The headline finding
> below is a real, unfixed vulnerability recorded here by owner decision
> (2026-07-11: document, do not patch). Do not "clean it up" as a drive-by —
> changing webhook authentication is an outward-facing security change with
> deliberate history (see the reverted mention-filter under §4). Raise it,
> don't silently patch it.

## 1. The headline: unauthenticated Feishu ingress → host shell with full secrets

The single most load-bearing fact about this server. Each link verified:

1. **Feishu webhook has no request authentication.**
   `FeishuAdapter.verifyRequest()` is a hardcoded `return true`
   (`src/adapters/feishu/adapter.ts:53-55`). The Feishu route calls it
   (`src/routes/feishu.ts:22`) and then parses the body with **no**
   signature / encrypt-key / verification-token check anywhere.
2. **The documented protection is dead config.**
   `FEISHU_ENCRYPT_KEY` / `FEISHU_VERIFICATION_TOKEN` appear in
   `.env.example:57-58` but are referenced **nowhere** in `src/` (full-tree
   grep is empty). `AGENTS.md` ("signature-verified webhook flow" / "Do not
   bypass platform signature verification") and `README.md` describe a check
   that does not exist. Operators are told they are protected; they are not.
3. **It is on by default.** `getFeishuEventSource()` falls through to
   `'webhook'` (`src/adapters/feishu/gateway.ts:21`) and `HOST` defaults to
   `0.0.0.0` (`src/index.ts:37`) — the vulnerable ingress is the default
   deployment shape, reachable on every interface.
4. **An agent run can execute arbitrary host shell with every secret.**
   `worktree_run` is registered **eagerly** (no `defer_loading`,
   `src/core/engine-singleton.ts:79` via `worktreeTools`), so every run can
   call it. Its default backend is `host`
   (`src/core/worktree/runner.ts` `normalizeBackend`), which
   `spawn`s `/bin/bash -lc <shell>` (`runner.ts:115-121`) with
   `env: { ...process.env, ... }` (`runner.ts:129-134`, and `buildHostEnv`
   at `runner.ts:246-252`) — inheriting `ANTHROPIC_API_KEY`,
   `OPENAI_API_KEY`, `INTERNAL_API_SECRET`, `FEISHU_APP_SECRET`,
   `DISCORD_BOT_TOKEN`, etc. The remote system prompt actively tells agents
   to prefer `backend:"host"` (`src/core/agent-runner.ts:271-276`).

**Net:** an anonymous POST shaped like a Feishu event → a full agent turn →
(instruct the agent to `worktree_prepare` then `worktree_run`) → host shell
with the server's entire secret environment. Two honest limits: (a)
`worktree_run` needs a worktree bound first, so it is a two-step agent
instruction inside the same anonymous conversation, not a single crafted
field; (b) even without the shell, an anonymous party can already drive
arbitrary agent turns (burn API budget, exfiltrate via `jina_ai_read` /
memory / `read_linked_session`). Floor = anonymous agent control; ceiling =
host RCE with secrets.

**Mitigations that exist but are not defaults:** the Docker backend
(`runner.ts:137-181`) drops uid:gid and network; switching
`FEISHU_EVENT_SOURCE=long_connection` removes the inbound webhook entirely
(Feishu dials out over an app-credentialed WebSocket instead). Neither is
the default.

## 2. Per-platform authentication reality

| Surface | Auth | Evidence |
|---|---|---|
| Feishu webhook | **NONE** (`return true`) | `adapters/feishu/adapter.ts:53-55` |
| Discord webhook | ED25519, fails closed | `adapters/discord/adapter.ts:110-138` — but **no timestamp-staleness check**, so replay is bounded only by Discord's own signing window |
| `/internal/*` | loopback + bearer | socket-address check (`routes/internal.ts:406-418`, not `X-Forwarded-For`-spoofable) + `INTERNAL_API_SECRET` |
| `/api/devtools/*` | **NONE** + `origin:'*'` CORS | `server.ts:21`, zero auth in `routes/devtools.ts` |

Two sharp edges on the internal path: (a) `INTERNAL_API_SECRET` is compared
with plain `===`, not `timingSafeEqual` (`routes/internal.ts:430-435`) —
low severity given loopback-only; (b) when the secret is **unset**, auth
reduces to `NODE_ENV !== 'production'` (`internal.ts:426-427`), so any
staging box that forgets `NODE_ENV=production` has fully open internal
routes to anything reaching loopback. Behind a reverse proxy every request
looks like loopback, collapsing the internal surface to the secret alone.

## 3. Devtools data exposure

`/api/devtools/*` is unauthenticated with wildcard CORS on the default
`0.0.0.0` host, and its routes expose cross-session token/cost stats **and
full LLM prompt snapshots** (`routes/devtools.ts` `getLlmPromptSnapshot`),
which can carry secrets/PII. Internet-exposed by default unless externally
firewalled. See `known-defects.md`.

## 4. Injection surface (external content into prompts)

Standard LLM-injection surface, catalogued for awareness (not novel bugs):
inbound platform message text goes straight into the user turn
(`agent-runner.ts:326`); Discord's "Ask Pulse" context-menu command injects
**another user's** message content (`adapters/discord/adapter.ts:661-671`);
`jina_ai_read` fetches arbitrary URLs into tool results;
`read_linked_session` reads other sessions' content. Combined with §1's
host tool, treat all inbound platform text as untrusted instruction.

History note: a `mention-filter` (verify a group @-mention targets THIS bot)
plus tests was added in commit `31fa38b` and reverted with no explanation
two hours later in `bbbc1e7`. Whoever revisits group-mention gating should
read that revert first — it was a deliberate removal, not an oversight.

## When you change things here

- Widening what an agent run can execute (new host-shell-shaped tool, new
  eagerly-registered tool) enlarges §1's ceiling — weigh `defer_loading`
  and the Docker backend.
- Adding a platform adapter: its `verifyRequest` is the ONLY ingress gate
  (there is no shared auth middleware for webhooks). A no-op there is a
  repeat of §1. There is a zero-test hole around every `verifyRequest`
  (`known-defects.md` §Test), so nothing catches a regression here.
- Adding an `/internal/*` route: the global middleware enforces loopback
  only; the bearer check is per-handler copy-paste
  (`internal.ts:121,130,139,148,162,201,229,250`). Forgetting it leaves the
  route loopback-protected but not secret-protected. See
  `../skills/add-internal-route/SKILL.md`.
