# Security Posture

What the Canvas Agent and this Electron app can do to the user's machine, and
which containment actually exists. Engine's own posture doc
(`packages/engine/harness/knowledge/security-posture.md`) ends with "the host
owns all sandboxing" — **this app is that host**, so this doc records what the
host actually does and does not gate. Facts verified against source
2026-07-07; `file:line` cites are the anchors.

## Execution reach of the Canvas Agent

- **Workspace chat keeps full-privilege engine built-ins; global chat does
  not.** Workspace scope still receives `read`, `write`, `edit`, `grep`, `ls`,
  and `bash` in the Electron **main process**, with no sandbox or path
  confinement. Global scope now passes an explicit `builtInTools` allowlist
  (`read`, `grep`, `ls`, Tavily read tools, and `clarify`); `write`, `edit`,
  `bash`, node-content mutation, and disk-writing image generation are absent
  from that Engine's built-in set. This boundary does not classify user-configured MCP/plugin
  tools, which remain separate trust surfaces described below.
- **A second command-execution path exists besides `bash`:**
  `canvas_create_terminal_node` (`src/main/agent/tools/terminals.ts:16`)
  accepts a `command` input that auto-executes once the PTY shell is ready.
  PTYs are real shells (`pty-manager.ts` spawns `powershell.exe`/`$SHELL`);
  output is forwarded only to the renderer webContents that spawned the
  session (`src/main/terminal/pty-manager.ts:15`).
- **No human-in-the-loop approval gate** — the engine has no approval hook
  and this app does not wrap tools with one. Every tool call is
  LLM-triggered.

## Auto-loaded disk surfaces (evaluated when an agent is built)

These make on-disk files an execution or injection surface:

- **Engine-plugin disk scan is ACTIVE — apparently by inheritance, not
  decision.** The engine scans `.pulse-coder/engine-plugins/**/*.plugin.{js,ts}`
  (and `.coder/`, home equivalents) and `await import()`s matches by default
  (`packages/engine/src/Engine.ts:201`: `scan: userPlugins.scan !== false`).
  `buildEngine()` passes `enginePlugins.plugins` WITHOUT `scan: false`
  (`canvas-agent.ts:679-689`), so dropping a plugin file into a scanned
  directory is arbitrary Node code execution in the Electron main process on
  the next agent construction. Engine's host checklist says hosts should
  *decide* this; no decision is recorded anywhere in this app.
- **Skills scan ingests OTHER TOOLS' directories.** Skill sources are the
  workspace dirs plus every standard global skill dir — `~/.pulse-coder`,
  `~/.claude`, `~/.codex`, etc. — plus canvas-plugin skill paths, with
  earlier-source-wins name shadowing (`canvas-agent.ts:659-668`). A SKILL.md
  planted for a *different* tool is loaded into this agent's context:
  prompt-level injection surface, not code execution.
- **MCP config** (global + workspace `mcp.json`, workspace overrides on same
  name): `stdio` servers spawn an arbitrary `command`, `http`/`sse` take an
  arbitrary `url` (`src/main/agent/mcp/config.ts:130-143`), plus an OAuth
  provider flow (`canvas-agent.ts:683-688`). Same SSRF/spawn shape as
  engine's posture doc describes.
- **Canvas node plugins** (`canvas-plugins.json` + `pluginDirs`,
  `src/main/settings/canvas-plugins-config.ts`) load external plugin code
  into main and renderer via manifests/registries.
- **Model config is the positive example:** it stores only env-var *names*
  for API keys, never secret values (`src/main/agent/model/config.ts`).

## Network & serving surfaces

- **dynamic-app loopback server**: one shared HTTP server bound to
  `127.0.0.1` on an ephemeral port (`src/plugins/main/dynamic-app/manager.ts:197`)
  serving **agent-generated app code** into sandboxed iframes. Loopback-only,
  but anything on the machine can fetch it once the port is known.
- **runtime-control server**: loopback-only (`127.0.0.1`, ephemeral port),
  with ownership verification before state cleanup
  (`src/main/runtime/control-server.ts:8,42,154`).
- **Embedded web content feeds the agent.** `webviewTag: true`
  (`src/main/app/window.ts:31-34`): iframe/link nodes host real webContents,
  and main-process code reads their rendered DOM for the Canvas Agent. Page
  text is untrusted input that can steer tool calls (prompt-injection →
  `bash`) — same class of risk as engine's "file content is untrusted"
  warning, extended to arbitrary web pages.
- **Link/popup policy is centralized** (`src/main/app/link-policy.ts`): every
  webContents the app ever creates gets a `setWindowOpenHandler` installed
  before its page can run JS; unsafe URLs are denied, OAuth-style popups get
  a real window, everything else is routed to the renderer's preview drawer
  instead of auto-opening.
- **Google sign-in compat is host-scoped UA identity swapping + popup
  rerouting** (`src/main/app/google-auth.ts`, `google-auth-popup.ts`):
  UA-*string* spoofing alone is detectable — Chromium emits UA Client Hints
  from the real bundled version and accounts.google.com rejects the
  mismatch. On the exact-match Google auth hosts only, a per-webContents
  Firefox UA override (suppresses client hints) plus a defaultSession
  header rewrite presents a consistent Firefox identity
  (`PULSE_GOOGLE_AUTH_IDENTITY=chrome` disables it — experiment arm only,
  known-broken on Electron 30). An honest current-Chrome identity was
  tried on Electron 42 (2026-07-17) and still rejected by `/v3/signin`
  post-submit; the upgrade was reverted — see the evidence log in
  google-auth.ts before re-running that loop. The allowlist is exact-match
  by design — it loosens navigation policy, so suffix lookalikes
  (`accounts.google.com.evil`) must never qualify. Google's strict
  full-page flow additionally risk-scores embedded surfaces, so in-place
  entry legs from `<webview>` guests are rerouted into a top-level
  BrowserWindow popup on the same session (with the opener page as
  referrer); the post-login continuation is handed back to the opener
  webview so the one-shot URL is consumed there.

## Containment that DOES exist

- `contextIsolation: true`; renderer reaches privileged behavior only through
  the typed preload bridge — and that boundary is mechanically enforced by
  `src/main/__tests__/import-boundaries.test.ts`.
- Both local servers are loopback-only with ephemeral ports.
- Centralized link/popup policy (above).
- Channel plugin is inert unless the experimental flag AND channel config are
  both enabled (`src/plugins/main/channel/index.ts:66`); credentials live in
  local settings/env, not source.
- The harness driver's `real` profile requires `--allow-real-writes` before
  it can touch real user data (`harness/tools/driver/src/profiles.mjs`).

## When you change things here

- Adding an agent tool = widening what a prompt-injected LLM can do with
  main-process privilege. Read this doc + `terminals.ts` for the precedent of
  gating side effects (spawn-target scoping) before adding execute-class
  tools.
- Anything that reads web/iframe content into agent context inherits the
  prompt-injection amplification above — treat page text like attacker input.
- If you touch `buildEngine()`, decide the engine-plugin `scan` question
  deliberately (it is currently inherited default-ON, undecided).
