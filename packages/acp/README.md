# pulse-coder-acp

Agent Client Protocol (ACP) client and runner for Pulse Coder hosts. Lets hosts — the CLI (`packages/cli`) and remote-server (`apps/remote-server`) — delegate execution to external ACP-compatible agents (Claude Code, Codex) via JSON-RPC over stdio.

## How It Works

```
Host (CLI / remote-server)
  → AcpClient spawns agent CLI as child process
  → JSON-RPC 2.0 over stdin/stdout
  → initialize → session/new → session/prompt (streaming)
  → session/update notifications → text deltas / tool calls
```

The `AcpClient` manages the child process lifecycle, and `runAcp` wraps the full session flow (init → new/resume → prompt → collect result) with retry and state persistence.

## Supported Agents

| Agent | Default command | Env override |
|-------|-----------------|--------------|
| `claude` | `claude-agent-acp` | `ACP_CLAUDE_CODE_CMD` |
| `codex` | `codex-acp` | `ACP_CODEX_CMD` |

The default command names above are what the client spawns; override either with the matching env var (or `commandOverrides` per call). Install paths for the agent binaries are host/environment-specific and not defined by this package.

## Exports

| Export | Description |
|--------|-------------|
| `AcpClient` | Low-level JSON-RPC client: spawn the agent child process, send requests/notifications, route responses, and handle `session/request_permission` + `fs/*` server requests |
| `runAcp(input)` | High-level runner: full session lifecycle (init → resume/load/new → prompt → collect) with retry, state persistence, and streaming callbacks |
| `listAcpSessions(input)` | List agent sessions via `session/list` (requires the `list` session capability) |
| `closeAcpSession(input)` | Close a session via `session/close` (requires the `close` capability; resumes/loads first when supported) |
| `FileAcpStateStore` | File-backed state store at `~/.pulse-coder/acp-state.json`; tracks agent/cwd/sessionId per channel |
| `buildAcpEnableState(existing, agent, cwd)` | Compute the next channel state, preserving `sessionId` only when agent and cwd are unchanged |
| `getAcpState` / `setAcpState` / `clearAcpState` | Convenience accessors over the default `FileAcpStateStore` |
| `updateAcpCwd` / `saveAcpSessionId` | Update the persisted cwd (resets `sessionId`) / persist a `sessionId` for a channel |
| `AcpTimeoutError` | Error raised when an ACP call exceeds its configured timeout |

Protocol and option types (e.g. `AcpRunnerInput`, `AcpRunnerResult`, `AcpRunnerCallbacks`, `AcpMcpServer`, `PermissionRequest`, `InitializeResult`) are re-exported from `src/types.ts`.

## Usage

```typescript
import { runAcp } from 'pulse-coder-acp';

const result = await runAcp({
  platformKey: 'discord:user:123',
  agent: 'claude',
  cwd: '/path/to/project',
  userText: 'Explain the auth module',
  callbacks: {
    onText: (delta) => process.stdout.write(delta),
    onToolCall: (tc) => console.log('tool:', tc),
  },
});

console.log(result.text);       // final response
console.log(result.sessionId);  // persisted for /resume
```

## Behavior Notes

- **Default client capabilities**: the runner advertises `fs.readTextFile` and `fs.writeTextFile` as `true` and `terminal` as `false` (`DEFAULT_CLIENT_CAPABILITIES` in `src/runner.ts`). `AcpClient` handles `fs/read_text_file` and `fs/write_text_file` server requests itself; terminal support is not advertised.
- **Permission handling**: in `allow` mode (default) permission requests are auto-approved. In `prompt` mode, when an `onClarificationRequest` callback is supplied, the runner surfaces a clarification and maps the answer to a permission option; without a callback it falls back to auto-approval.
- **Abort**: passing `abortSignal` causes the runner to send `session/cancel` for the active session when the signal aborts.
- **MCP servers**: `mcpServers` is forwarded to `session/new` and the reconnect method (`session/resume` or `session/load`); defaults to an empty list.

## Configuration

| Env var | Description |
|---------|-------------|
| `ACP_PERMISSION_MODE` | `allow` (default) or `prompt` — controls tool permission handling |
| `ACP_DEBUG` | `1` or `true` to log all raw JSON-RPC messages |
| `ACP_RETRY_MAX` | Max retries on transient failures (default: 2) |
| `ACP_RETRY_BASE_DELAY_MS` | Retry backoff base in ms (default: 750) |
| `ACP_DISABLE_PROXY` | `1`/`true`/`yes`/`on` to strip `HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY` from the child env |
| `ACP_INIT_TIMEOUT_MS` | Timeout for `initialize` in ms (default: 30000) |
| `ACP_SESSION_TIMEOUT_MS` | Timeout for `session/new`, `session/resume`/`session/load`, `session/list`, `session/close` in ms (default: 30000) |
| `ACP_PROMPT_IDLE_TIMEOUT_MS` | Idle timeout for `session/prompt` in ms — resets on each `session/update` (default: 600000) |
| `ACP_PROMPT_HARD_TIMEOUT_MS` | Hard ceiling for `session/prompt` in ms (default: 1800000) |
| `ACP_CANCEL_TIMEOUT_MS` | Timeout for `session/cancel` (abort) in ms (default: 10000) |
| `ACP_PROMPT_TIMEOUT_MS` | Legacy alias for `ACP_PROMPT_IDLE_TIMEOUT_MS` (default: 600000); overridden by the explicit idle var |

`CLAUDECODE` is always stripped from the child env (it causes Claude Code to refuse a nested launch). When a transient error occurs and proxy env is present, the runner strips proxy vars on all subsequent retries, even without `ACP_DISABLE_PROXY`.

## Build & Test

```bash
pnpm --filter pulse-coder-acp build
pnpm --filter pulse-coder-acp test
pnpm --filter pulse-coder-acp typecheck
```
