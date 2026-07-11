---
name: add-platform-adapter
description: Use when adding a chat platform (like feishu/discord/telegram/web) to remote-server. Covers the four PlatformAdapter methods, the eager-instantiation import trap, the separate mount step, the verifyRequest security gate, and the per-adapter blocks (clarification-consume, cancel-token) that are hand-copied and easy to omit.
---

# Add a Platform Adapter

An ordered procedure. Gives the SEQUENCE and the landmines; FACTS live in the
sources it points to — do not restate them here. `discord` is the most
complete reference (real verification + gateway + cancel tokens); `feishu`
is the reference for card streaming; both live under `src/adapters/`.

## Steps

1. **Snapshot the registries first.** `node harness/tools/describe-remote-server.mjs` — the mounted-routes list and the commented-out (implemented-but-not-mounted) mounts are your before/after.

2. **Implement all four `PlatformAdapter` methods** (`src/core/types.ts`): `verifyRequest`, `parseIncoming`, `ackRequest`, `createStreamHandle`. Match a sibling adapter's shape.

3. **`verifyRequest` IS the ingress gate — a no-op is a vulnerability.** There is NO shared webhook auth middleware; each adapter's `verifyRequest` is the only thing standing between a public POST and a full agent run with host-tool access. The Feishu adapter ships `return true` (`src/adapters/feishu/adapter.ts:53-55`) — read `harness/knowledge/security-posture.md §1` for what that costs before you copy it. Implement the platform's real signature/token check (Discord's ED25519 at `adapters/discord/adapter.ts:110-138` is the model: fail closed on missing key/sig/timestamp).

4. **The eager-instantiation import trap.** Adapters are instantiated at the file's last line (`export const fooAdapter = new FooAdapter()`). A constructor that throws when a required env var is missing breaks the *import* of anything that pulls it in — the Telegram adapter throws at module load without `TELEGRAM_BOT_TOKEN` (`adapters/telegram/adapter.ts:145,22-24`), which is why mounting it would crash startup on a box without the token. Make the constructor lazy/tolerant; defer the throw to first use.

5. **Mounting is a SEPARATE step.** Having an adapter + a route file does not mount it — `src/server.ts` must `app.route('/webhooks/<platform>', <router>)`. Telegram and Web have adapters and routes but sit commented out (`server.ts:30,37`). Un-comment the mount AND update AGENTS.md's "default mounted surface" sentence + README's endpoint table in the same change.

6. **The per-adapter blocks that are hand-copied 4×.** Two behaviors are duplicated per adapter, not shared, so a new adapter silently lacks them unless you copy them: (a) the **clarification-consume** block — when a clarification is pending, the next inbound message must be routed as the answer via `getActiveStreamId`+`hasPending` (see `feishu/adapter.ts:220-236`); (b) **cancel-token registration** so a platform-native cancel (Discord's `❌` reaction) can abort a run — only Discord's channel path does this today (`discord/adapter.ts:300-302`), and even it misses the interaction path (`known-defects.md §4`). Decide consciously whether your platform needs each.

7. **platformKey format must stay in sync with the parsers.** The `platformKey` your adapter builds is later re-parsed by `parseChannelInfo` (`agent-runner.ts`) and `resolveOwnerKey` (`session-store.ts`) for channel context and cross-owner session access. A format those regexes don't recognize silently breaks context/ownership for your platform — check both before inventing a key shape.

8. **Verify.** `node harness/tools/describe-remote-server.mjs` (new mount shows, no command drift); `pnpm --filter @pulse-coder/remote-server build`; `test`. If you added verification, add the FIRST `verifyRequest` regression test (that layer has zero coverage — `known-defects.md §Test`).

## Done when

All four methods implemented; `verifyRequest` does a real check (or the security tradeoff is explicitly stated); constructor doesn't throw at import; the mount is added and the docs updated in lockstep; clarification-consume and cancel-token decided consciously; describe-remote-server clean; build + test green.
