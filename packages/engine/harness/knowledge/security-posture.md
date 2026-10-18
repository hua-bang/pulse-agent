# Security Posture

What the engine can do to a machine, and what it does NOT gate. Written for host authors deciding what sandboxing they must add. This is a posture description, not a bug list — the one confirmed exploitable defect (grep) is now fixed; the rest is by-design absence of gating that the HOST must cover.

## The one rule

**The engine ships zero containment. The host owns all sandboxing.** There is no sandbox, no command allowlist, no filesystem-root confinement, and no human-in-the-loop approval hook anywhere in the engine. Every built-in tool runs with the full privileges of the host process.

## Execution & network reach (default tool set)

- **bash** — arbitrary shell commands at host-process privilege and env; the only limits are a timeout and a 10 MB output cap. No allowlist, no approval.
- **read / write / edit / ls** — any absolute path the process user can reach; no workspace-root containment. `read` can return `~/.ssh/id_rsa`; `write`/`edit` can modify anything writable.
- **grep** — runs `rg` via `execFile` with an argument array (no shell). The former shell-string build had a command-injection hole (agent-controlled pattern → shell); that is fixed and regression-tested. Still reads any path the user can reach.
- **generate_image / tavily** — outbound HTTP to configured endpoints; write generated images to disk.

## Auto-loaded disk surfaces (evaluated on every Engine construction)

These make on-disk config an execution surface, not just data:

- **`.pulse-coder/engine-plugins/**/*.plugin.{js,ts}`** (and `.coder/`, home equivalents) — scanned by default and `await import()`ed; the loader only checks that `.name`/`.initialize` exist. Dropping a file here is arbitrary Node code execution on the next Engine build.
- **MCP config** (`.pulse-coder/mcp.json` + variants) — `http`/`sse` servers take an arbitrary `url` plus arbitrary `headers`/OAuth with no host allowlist (SSRF-shaped); `stdio` servers spawn an arbitrary `command`/`args`/`env`/`cwd`. Loaded automatically at init.
- **`AGENTS.md` in `process.cwd()`** — appended to the system prompt as project instructions, so repository text reaches the model with system-prompt weight.
- **No workspace trust gate (owner decision, 2026-10: document, do not gate).** The project-relative paths above resolve against `process.cwd()`. Starting the CLI inside a cloned repository therefore imports that repository's `*.plugin.js` files and spawns its `stdio` MCP commands without any prompt. `disableBuiltInPlugins` does not turn the engine-plugin scan off: the scan runs unless `enginePlugins.scan === false`. Hosts that run in untrusted directories must set `scan: false` and pass explicit MCP config files (`createMcpPlugin({ configPaths })`).

Declarative user-config files (`.pulse-coder/config/*`) are no longer parsed at all (removed 2026-10).

## What little gating exists (and its limits)

- **plan-mode** (since 2026-08-16) hard-blocks mutating tools in planning mode at the `beforeToolCall` boundary: any tool classified `write`/`execute` is short-circuited with a synthetic rejection, and `bash` runs a read-only command classifier (`plan-mode-plugin/readonly-command.ts`) so only the built-in read-only set (`ls`, `cat`, `echo`, `pwd`, `head`, `tail`, `grep`, `find`, `wc`, `which`, `diff`, `stat`, `du`, `cd`, read-only `git`) executes. It is a *policy boundary for the LLM loop*, still not a sandbox: it assumes the engine process itself is trusted, and its mutating classification falls back to name inference for unknown tools (`KNOWN_TOOL_META` + regex). It is not human-in-the-loop and does not cover executing mode.
- **ptc `allowed_callers`** is an exposure filter, not an approval gate, and it UNIONS typed + untyped allowlists (declaring both broadens access). Registered last in the pipeline, so it only sees tools earlier stages left.
- Neither is human-in-the-loop.
- Sub-agent runs execute through the parent engine's loop hooks with the parent's policy tool table and abort signal (`Engine.runChild`), so plan-mode, ptc, host `builtInTools` selection and `beforeToolCall` policies apply inside them, and they cannot call further `*_agent` tools. Before 2026-10 they rebuilt tools from `BuiltinToolsMap` with no hooks.

## Host checklist

If you embed the engine in a context where the model, its inputs, or its config directory are not fully trusted:
- Sandbox the process (container / seccomp / restricted user) — the engine will not do it.
- Decide whether to disable the engine-plugin disk scan (`scan: false`) and pin MCP servers to an allowlist.
- Add your own approval gate around `bash`/`write`/MCP if your product needs one — there is no engine hook for it; wrap the tools before injecting them.
- Treat file content the agent reads as untrusted input that can steer tool calls (prompt-injection → tool-use).
