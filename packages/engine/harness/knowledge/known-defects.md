# Known Defects

Confirmed-but-unfixed defects in `packages/engine`, surfaced by a multi-model deep scan during the harness build and re-verified against source. Unlike the spec entries (`../spec/`), these are **not** judgement calls — the intended behavior is not in question, only the fix is outstanding. Unlike root `AGENTS.md` §6 Failure Capture, these are pre-fix (no guard/regression test exists yet).

Severity reflects whether the defect is reachable on a real path today (**live**), reachable only under a specific unset-config combination (**conditional**), or reachable only by a host that does not exist yet (**latent**). Fix one → move it to §6 with a regression test and delete its row here.

## LIVE

### `generateTextAI` never sets `maxOutputTokens` — agent-teams calls cap at 4096
`src/ai/index.ts:56-70`. The file's own header comment (`:11-24`) documents exactly why omitting `maxOutputTokens` is a bug: the Vercel AI SDK does not default it, so the Anthropic provider falls back to a 4096 protocol cap that Claude burns on thinking tokens, surfacing as `finishReason='length'` with `textLen=0` and getting misdiagnosed as context overflow. `streamTextAI` was fixed to pass `resolveMaxOutputTokens(...)` (`:160`); `generateTextAI` still does not, and also hardcodes `openaiProviderOptions` (`:69`) instead of `resolveProviderOptions(modelType)`. It is **not dead code** — `agent-teams-plugin/index.ts:54`, `packages/cli/src/team-commands.ts:21`, and `packages/agent-teams/src/planner.ts:81` all call it for team planning. Those calls carry the exact bug the comment warns about. Fix: pass `maxOutputTokens` (and provider options) the way `streamTextAI` does; `generateTextAI` has no `modelType` param today, so plumb one or resolve a sane default.

### `formatUpstreamError` bakes host-specific Chinese UX into the core loop
`src/core/loop.ts:846+`. Returns user-facing strings that are hardcoded Chinese and remote-server-specific: they reference "remote-server 的运行锁" and instruct the user to run `/compact` / `/new` slash commands (`:862`, `:865`, `:873`). `packages/engine/AGENTS.md` (Module Positioning) says the engine must stay host-agnostic — CLI/remote/canvas/ACP UX belongs in the host, not `core/loop.ts`. Any host without those slash commands, or with a non-Chinese audience, surfaces this copy verbatim. Fix: move the presentation to a host callback / structured error the host renders, leaving the loop to emit a neutral typed error.

### System prompt hardcodes `Platform: darwin`
`src/prompt/system.ts:129`. The `<env>` block interpolates `process.cwd()` and the date but hardcodes `Platform: darwin`, so on every Linux/Windows host (remote-server runs on Linux) the model is told it is on macOS and may suggest darwin-only commands. Fix: interpolate `process.platform` (or `os.platform()`), consistent with the neighboring `process.cwd()`.

## CONDITIONAL

### `COMPACT_SUMMARY_MODEL` empty-string breaks the `?? DEFAULT_MODEL` fallback
`src/ai/index.ts:172`: `const model = options?.model ?? COMPACT_SUMMARY_MODEL ?? DEFAULT_MODEL;`. `COMPACT_SUMMARY_MODEL` is `(process.env.COMPACT_SUMMARY_MODEL ?? '').trim()` (`src/config/index.ts:107`) — an **empty string** when the env var is unset, not `undefined`. Nullish `??` does not treat `''` as absent, so `'' ?? DEFAULT_MODEL` evaluates to `''` and `DEFAULT_MODEL` is never reached. The real caller `src/context/index.ts:203-206` passes `model: options?.model`, so when the compaction path runs without an explicit model AND `COMPACT_SUMMARY_MODEL` is unset, `summarizeMessages` calls the provider with an empty model string. Fix: coalesce the empty string to `undefined` at the config export, or use `|| DEFAULT_MODEL` for this fallback specifically.

## LATENT

### `onResponse` is invoked fire-and-forget
`src/core/loop.ts:667` calls `options?.onResponse?.(messages)` without `await`, and the type is `(messages) => void` (`:199`). Every host today mutates synchronously — remote-server `agent-runner.ts:402-406` and canvas both just `push`/reassign `context.messages` — so there is no live race. The defect is the contract: a host that does async persistence inside `onResponse` (a natural thing to want) would have the loop advance before the write settles, with no back-pressure. Fix is a decision-lite bug (await the callback and widen the type to `=> void | Promise<void>`), but it is only worth doing when/if a host needs async there — recorded so the next author does not assume the callback is awaited.

---

**Verification.** All five confirmed against source on the working branch (2026-07-07) at the cited lines, including caller/blast-radius greps (`generateTextAI` callers, `summarizeMessages` caller passing `model`, `onResponse` host callers all synchronous).
