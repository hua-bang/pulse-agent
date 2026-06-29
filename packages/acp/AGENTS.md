# AGENTS.md - packages/acp

> Local entry for `packages/acp`.
> Repository harness entry: `../../harness/README.md`.

## Module Positioning

`pulse-coder-acp` owns the ACP client and runner used by Pulse Coder hosts to delegate work to external ACP-compatible agents such as Claude Code and Codex. It manages JSON-RPC over stdio, child process lifecycle, session lifecycle, permission requests, file request handlers, streaming updates, retry/timeout policy, and persisted per-channel ACP state.

ACP protocol behavior is contract-heavy. Hosts such as the CLI and remote server depend on stable types, method names, callback shapes, session persistence, and environment behavior.

## Knowledge Navigation

| Task | Read |
|---|---|
| Package overview and scripts | `README.md`, `package.json` |
| Public exports | `src/index.ts` |
| Protocol types and callback contracts | `src/types.ts` |
| JSON-RPC client and child process behavior | `src/client.ts` |
| Runner lifecycle, retry, timeout, permission, session list/close | `src/runner.ts` |
| State model and file persistence | `src/state.ts`, `src/state-store.ts` |
| CLI host commands | `../cli/src/acp-commands.ts` |
| Focused behavior tests | `src/client.test.ts`, `src/runner.test.ts`, `src/state.test.ts` |

## Local Constraints

- Treat protocol types, runner behavior, and state persistence as public contracts.
- Avoid host-specific policy in the ACP package.
- Default persisted state is `~/.pulse-coder/acp-state.json`; state compatibility changes should include tests or a migration note.
- Preserve current enable-state semantics: keep `sessionId` only when agent and cwd are unchanged; reset it when either changes.
- Preserve default external command names (`claude-agent-acp`, `codex-acp`) and env overrides (`ACP_CLAUDE_CODE_CMD`, `ACP_CODEX_CMD`) unless host migration is planned.
- `runAcp` strips `CLAUDECODE` from child env and can strip proxy vars when retrying or when `ACP_DISABLE_PROXY` is set; change env inheritance carefully.
- The runner advertises fs read/write capability by default and keeps terminal capability false; update client handlers and tests before changing capabilities.
- Route protocol changes through `../../harness/skills/contract-coding.md`.

## Common Commands

```bash
pnpm --filter pulse-coder-acp test
pnpm --filter pulse-coder-acp typecheck
pnpm --filter pulse-coder-acp build
```

Tests use local fakes and a short-lived Node child process; they should not require an installed external ACP agent.

## Key Files

- `src/index.ts`: public exports for client, runner, state helpers, state store, and protocol types.
- `src/types.ts`: ACP agent, state, callback, capability, session, permission, and protocol result types.
- `src/client.ts`: child process spawning, JSON-RPC request/response routing, notifications, permission requests, fs handlers, command/env resolution, and call timeouts.
- `src/runner.ts`: initialize, resume/load/new session flow, prompt streaming, retry/backoff, proxy fallback, progress timeouts, permission clarification, session list, and session close.
- `src/state.ts`, `src/state-store.ts`: default file-backed state helpers and `FileAcpStateStore`.
- `src/*.test.ts`: current coverage for client timeouts, runner timeout/session capability helpers, and state enable semantics.
