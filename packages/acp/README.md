# pulse-coder-acp

Agent Context Protocol (ACP) client and runner for Pulse Coder hosts. Enables remote-server channels to delegate execution to external ACP-compatible agents (Claude Code, Codex) via JSON-RPC over stdio.

## How It Works

```
Host (remote-server)
  → AcpClient spawns agent CLI as child process
  → JSON-RPC 2.0 over stdin/stdout
  → initialize → session/new → session/prompt (streaming)
  → SessionUpdate notifications → text deltas / tool calls
```

The `AcpClient` manages the child process lifecycle, and `runAcp` wraps the full session flow (init → new/resume → prompt → collect result) with retry and state persistence.

## Supported Agents

| Agent | Default command | Env override |
|-------|----------------|-------------|
| `claude` | `claude-agent-acp` | `ACP_CLAUDE_CODE_CMD` |
| `codex` | `codex-acp` | `ACP_CODEX_CMD` |

Install via `npm install -g @zed-industries/claude-agent-acp` or `@zed-industries/codex-acp`.

## Exports

| Export | Description |
|--------|-------------|
| `AcpClient` | Low-level JSON-RPC client — spawn, send requests/notifications, handle responses |
| `runAcp(input)` | High-level runner — full session lifecycle with retry, state persistence, and streaming callbacks |
| `FileAcpStateStore` | File-based state store at `~/.pulse-coder/acp-state.json` — tracks active agent/cwd/sessionId per channel |
| `getAcpState` / `setAcpState` / `clearAcpState` | Convenience functions using the default `FileAcpStateStore` |

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

## Configuration

| Env var | Description |
|---------|-------------|
| `ACP_PERMISSION_MODE` | `allow` (default) or `prompt` — controls tool permission handling |
| `ACP_DEBUG` | `1` to log all raw JSON-RPC messages |
| `ACP_RETRY_MAX` | Max retries on transient failures (default: 2) |
| `ACP_RETRY_BASE_DELAY_MS` | Retry backoff base (default: 750) |
| `ACP_DISABLE_PROXY` | `1` to strip `HTTP_PROXY`/`HTTPS_PROXY` from child env |

## Build & Test

```bash
pnpm --filter pulse-coder-acp build
pnpm --filter pulse-coder-acp test
pnpm --filter pulse-coder-acp typecheck
```
