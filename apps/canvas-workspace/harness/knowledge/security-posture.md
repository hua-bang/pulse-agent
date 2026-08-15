# Security Posture

What the Canvas Agent and this Electron app can do to the user's machine, and
which containment actually exists. Engine's own posture doc
(`packages/engine/harness/knowledge/security-posture.md`) ends with "the host
owns all sandboxing" — **this app is that host**, so this doc records what the
host actually does and does not gate. Facts verified against source
2026-07-31; `file:line` cites are the anchors.

## Execution reach of the Canvas Agent

- **Workspace chat keeps full-privilege engine built-ins; interactive global
  chat now has useful file/image capabilities plus explicit-target Canvas
  operations; scheduled runs stay narrower.** Workspace scope receives
  `read`, `write`, `edit`, `grep`, `ls`, and `bash` in the Electron **main
  process**, with no sandbox or path confinement. Interactive global chat gets
  those file/image tools plus the web/clarification tools, while every
  workspace-bound Canvas tool added to Global chat requires an explicit
  `workspaceId`; the target tool set is resolved lazily for that id. Scheduled
  runs continue to use the narrower `read`, `grep`, `ls`, `bash`, Tavily, and
  `clarify` allowlist and the Global Canvas factory without target-workspace
  mutations. This split is
  deliberate: Global is useful as a cross-workspace router without giving an
  unattended task a Canvas mutation path. All of these built-ins still run in
  the main process without a sandbox. This boundary does not classify
  user-configured MCP/plugin tools, which remain separate trust surfaces
  described below.
  `bash` remains available because useful global/scheduled work is shell work
  — `lark-cli`, `ntn` and friends — but it is arbitrary process execution at
  main-process privilege, and scheduled runs reach it with nobody watching on
  a prompt that may have been shaped by injected web/page content.
- **A second command-execution path exists besides `bash`:**
  `canvas_create_terminal_node` (`src/main/agent/tools/terminals.ts:16`)
  accepts a `command` input that auto-executes once the PTY shell is ready.
  PTYs are real shells (`pty-manager.ts` spawns `powershell.exe`/`$SHELL`);
  output is forwarded only to the renderer webContents that spawned the
  session (`src/main/terminal/pty-manager.ts:15`).
- **Approval exists only in interactive Ask mode; Auto and Scheduled remain
  ungated.** Ask mode installs `createCanvasAskModeToolPolicyPlugin` at the
  engine's final `beforeToolCall` boundary, after MCP, deferred, and other
  plugin tools have joined the run. Classified reads proceed; every write,
  execute, destructive, or unknown operation pauses for an explicit
  Allow/Reject request. Missing renderer delivery, abort, and the five-minute
  timeout resolve to `No`, and externally-driven Claude/Codex roles require
  approval before their process starts. This is a consent prompt, not a
  sandbox: an approved call still has main-process privilege. Auto mode does
  not prompt, and Scheduled maps deliberately to Auto because no user may be
  present; the unattended `bash` risk above therefore remains.

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
  (`src/main/runtime/control-server.ts`). Its per-run bearer secret is written
  mode `0600`; experimental `/capabilities/*` routes are additionally hidden
  unless `agent-runtime-control` is enabled. This is an enablement gate, not a
  sandbox: any same-user process that can read the runtime file can invoke the
  exposed capabilities while the flag is on. Two explicit `unsafe` exceptions
  exist: `browser.page.eval` executes JavaScript in an eligible guest page when
  webview page control is also enabled, and `host.renderer.eval` executes
  JavaScript in the selected Pulse Canvas renderer route. Host eval has no
  direct Node `require`, but runs in the renderer main world and can use the
  exposed `window.canvasWorkspace` preload bridge to trigger privileged main
  actions. It can also read and mutate DOM-visible host UI state; a
  non-terminating synchronous script can freeze that renderer. Treat enabling
  it as granting same-user local code full experimental app-control authority.
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

## Runtime-control capability tiers and registry

This elaborates the runtime-control server entry above with the capability
registry's own contract: file location, access tiers, current contents, and
the two `unsafe` capabilities in full. The network/bearer-auth boundary
described there (loopback, ephemeral port, mode-`0600` per-run secret,
`/capabilities/*` hidden unless `agent-runtime-control` is enabled) applies
to everything below.

- **Where capabilities live**: `src/main/runtime/capabilities/` (registry,
  runtime, and per-domain capability modules). Stable Canvas Agent tools may
  adapt to these capabilities without changing their own public names or
  payloads — the tool surface the agent sees can stay stable even as the
  underlying capability registry changes.
- **Discovery and policy are filtered together**: capability discovery
  includes each capability's input JSON schema, and the runtime policy must
  filter discovery and execution through the same check — a capability an
  actor cannot execute must not be discoverable either.
- **Access tiers**: every capability is tagged `read`, `operate`, or
  `unsafe`. Pulse CLI may access `read`/`operate`, never `unsafe`, by
  default.
- **Current registry contents**: the shared registry currently exposes
  browser-tab discovery, live page reads, and Canvas node read/search/update
  (all `read`/`operate`), plus — only when the `webview-page-control`
  experimental flag is also enabled — selector-based page click/fill.
- **`browser.page.eval`** is the `unsafe` capability for arbitrary page
  JavaScript. It sits behind the stable, deferred `page_eval` Canvas Agent
  tool, and requires BOTH experimental flags for external (Pulse CLI)
  access: `agent-runtime-control` to reach `/capabilities/*` externally at
  all, and `webview-page-control` for the capability's own policy check.
- **`host.renderer.eval`** is the separate `unsafe` capability for arbitrary
  host-renderer JavaScript, behind the deferred `host_renderer_eval` Canvas
  Agent tool and the `pulse-canvas runtime host-eval` CLI command. It
  requires `agent-runtime-control`, checks the selected workspace route
  before executing, and runs in the host page's main world — see the
  containment note above for why the lack of a direct Node `require` still
  makes it `unsafe` (the `canvasWorkspace` preload bridge reaches privileged
  main actions).
- **`browser.page.eval` and `host.renderer.eval` are the ONLY Pulse CLI
  `unsafe` exceptions.** Every other capability stays within `read`/
  `operate` for CLI callers.
- **Canvas node writes stay scoped even for CLI callers**: external
  (Pulse CLI) node updates through the Canvas node capability are limited to
  title/content; arbitrary internal `data` patches remain
  Canvas-Agent-only.

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
- Scheduled-task writes from the agent (`scheduled_task_create` /
  `scheduled_task_update`, `src/main/agent/tools/scheduled.ts`) are bounded by
  three deliberate choices, not by a capability gate: all three tools are
  `defer_loading` so they are absent until explicitly loaded; every write
  broadcasts `scheduled:changed`, so a new or edited task appears in the
  Scheduled page rather than landing silently; and deleting is not exposed at
  all (removal stays a UI action). Their descriptions restrict calls to what
  the user asked in their own words — the same description-level convention
  `memory_adopt` relies on.

## When you change things here

- Adding an agent tool = widening what a prompt-injected LLM can do with
  main-process privilege. Read this doc + `terminals.ts` for the precedent of
  gating side effects (spawn-target scoping) before adding execute-class
  tools.
- A tool that schedules FUTURE unattended runs is a persistence mechanism, not
  a one-shot side effect: injected content that reaches it survives the turn.
  `scheduled_task_*` is the current precedent. Scheduled task chat keeps the
  app-level scheduling tools, but its Agent scope uses the unattended-safe
  built-in/Canvas boundary rather than interactive Global's explicit-target
  mutation surface.
- Anything that reads web/iframe content into agent context inherits the
  prompt-injection amplification above — treat page text like attacker input.
- If you touch `buildEngine()`, decide the engine-plugin `scan` question
  deliberately (it is currently inherited default-ON, undecided).
