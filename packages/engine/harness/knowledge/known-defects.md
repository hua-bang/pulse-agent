# Known Defects

Confirmed-but-unfixed defects in `packages/engine`, surfaced by a multi-model deep scan during the harness build and re-verified against source. Unlike the spec entries (`../spec/`), these are **not** judgement calls — the intended behavior is not in question, only the fix is outstanding. Unlike root `AGENTS.md` §6 Failure Capture, these are pre-fix (no guard/regression test exists yet).

Severity reflects whether the defect is reachable on a real path today (**live**), reachable only under a specific unset-config combination (**conditional**), or reachable only by a host that does not exist yet (**latent**). Fix one → move it to §6 with a regression test and delete its row here.

## LIVE

### `formatUpstreamError` bakes host-specific Chinese UX into the core loop
`src/core/loop.ts:846+`. Returns user-facing strings that are hardcoded Chinese and remote-server-specific: they reference "remote-server 的运行锁" and instruct the user to run `/compact` / `/new` slash commands (`:862`, `:865`, `:873`). `packages/engine/AGENTS.md` (Module Positioning) says the engine must stay host-agnostic — CLI/remote/canvas/ACP UX belongs in the host, not `core/loop.ts`. Any host without those slash commands, or with a non-Chinese audience, surfaces this copy verbatim. Fix: move the presentation to a host callback / structured error the host renders, leaving the loop to emit a neutral typed error.

## LATENT

### `onResponse` is invoked fire-and-forget
`src/core/loop.ts:667` calls `options?.onResponse?.(messages)` without `await`, and the type is `(messages) => void` (`:199`). Every host today mutates synchronously — remote-server `agent-runner.ts:402-406` and canvas both just `push`/reassign `context.messages` — so there is no live race. The defect is the contract: a host that does async persistence inside `onResponse` (a natural thing to want) would have the loop advance before the write settles, with no back-pressure. Fix is a decision-lite bug (await the callback and widen the type to `=> void | Promise<void>`), but it is only worth doing when/if a host needs async there — recorded so the next author does not assume the callback is awaited.

---

**Verification.** Confirmed against source on the working branch (2026-07-07) at the cited lines, including caller/blast-radius greps (`onResponse` host callers all synchronous). Re-checked 2026-10-17: both rows still apply (line numbers in `loop.ts` have moved; search for `formatUpstreamError` and `onResponse`). The former `generateTextAI` output-cap, `Platform: darwin` and empty `COMPACT_SUMMARY_MODEL` rows were fixed with regression tests (`src/ai/model-resolution.test.ts`, `src/prompt/system.test.ts`) and removed.
