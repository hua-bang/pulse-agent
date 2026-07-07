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

## What little gating exists (and its limits)

- **plan-mode** removes only `write`/`edit` from the tool list in planning mode — `bash`, MCP, and sub-agent tools remain callable. It is an LLM-instruction mechanism, not a security boundary.
- **ptc `allowed_callers`** is an exposure filter, not an approval gate, and it UNIONS typed + untyped allowlists (declaring both broadens access). Registered last in the pipeline, so it only sees tools earlier stages left.
- Neither is human-in-the-loop.

## Host checklist

If you embed the engine in a context where the model, its inputs, or its config directory are not fully trusted:
- Sandbox the process (container / seccomp / restricted user) — the engine will not do it.
- Decide whether to disable the engine-plugin disk scan (`scan: false`) and pin MCP servers to an allowlist.
- Add your own approval gate around `bash`/`write`/MCP if your product needs one — there is no engine hook for it; wrap the tools before injecting them.
- Treat file content the agent reads as untrusted input that can steer tool calls (prompt-injection → tool-use).
