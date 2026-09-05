# AGENTS.md - apps/canvas-workspace

Local router for Pulse Canvas. Read root AGENTS and harness/README.md first. CLAUDE.md is a thin import shell; edit this file.

## Role and ownership

This active pnpm workspace owns the Electron shell, React renderer, preload bridge, canvas persistence/migration, Canvas Agent chat, agent teams, plugins, webviews, terminal/agent PTYs, artifacts, settings, and runtime-control server. It consumes engine/agent-teams and interoperates with canvas-cli through storage and runtime capabilities.

The app owns migrations, PTYs, plugin activation, runtime endpoints, and UI-visible recovery; the CLI adapts. External plugin-node history and examples belong to plugin-node-mf2.md.

harness/ is the repo container for Knowledge, Tools, Validate, Skills, and optional Spec. The driver is also a product-operation CLI. Repo action skills are distinct from src/main/agent/skills runtime features and the externally installed pulse-canvas skills. Existing docs/ holds project records.

## Required task routes

A matching trigger requires reading its owner before changing code. Keep detailed mechanisms and test inventories there.

| Change / task | Required resource |
|---|---|
| Main/renderer/preload boundary, shared contracts | `harness/knowledge/conventions/architecture-boundaries.md`, `harness/skills/add-ipc-surface/SKILL.md` |
| Renderer conventions / module architecture | `harness/knowledge/conventions/frontend.md`, `harness/spec/renderer-modules/README.md`, `harness/skills/check-renderer-structure/SKILL.md` |
| Main conventions / domain and entry map | `harness/knowledge/conventions/backend.md`, `harness/knowledge/main-domain-modules.md` |
| Full-app routes, shell, Library, dock placement | `harness/knowledge/renderer-surfaces.md` |
| Child-process PATH, bundled CLI/skills, install/repair queue | `harness/knowledge/packaged-tooling.md` |
| Chat runtime/queue/stop, sessions/loading, approvals, attachments, rail, dock chat and widths | `harness/knowledge/chat-sessions.md` |
| Multi-role chat, external drivers, relay, stopped-versus-failed behavior | `harness/knowledge/agent-roles.md` |
| Keyboard shortcuts, menu accelerators, terminal/webview key ownership | `harness/knowledge/keyboard-shortcuts.md` |
| Agent/terminal xterm fit and sizing | `harness/knowledge/terminal-surfaces.md` |
| Coding Agent roster, branding, launch flags, session binding | `harness/knowledge/coding-agent-registry.md` |
| Dock browser, focus/navigation, retention/capture, overflow | `harness/knowledge/dock-browser.md` |
| Knowledge-node detail panels and cross-surface behavior | `harness/knowledge/node-detail.md` |
| Storage, edges, mindmap transactions, artifact pins | `harness/knowledge/main-domain-modules.md`, `src/shared/canvas.ts` |
| Runtime security, memory/adoption, artifact capabilities, headless runs | `harness/knowledge/security-posture.md` |
| Schedules, catch-up/DST, completion notification flow | `harness/knowledge/scheduled-tasks.md` |
| Agent plugins market, package/trust state, MCP adaptation | `harness/knowledge/plugin-market.md` |
| Add node capability / plugin node contract | `harness/skills/add-canvas-node/SKILL.md`, `harness/knowledge/plugin-node-mf2.md` |
| Add agent tool / built-in main plugin | `harness/skills/add-agent-tool/SKILL.md`, `harness/skills/add-builtin-main-plugin/SKILL.md` |
| Capability shared by Tool + CLI | `../../harness/skills/add-canvas-capability/SKILL.md` |
| Latency and tracing | `harness/skills/diagnose-agent-latency/SKILL.md`, `harness/knowledge/langfuse-observability.md` |
| Add/reuse a UI primitive or verify visual baseline | `harness/skills/extend-blessed-ui/SKILL.md`, `harness/tools/ui-showcase/README.md` |
| Agent teams / channel plugin | `src/main/agent-teams/`, `src/renderer/src/modules/agent-team/`; `src/plugins/main/channel/README.md` |
| Drive the app / choose validation | `harness/skills/canvas-harness/SKILL.md`, `harness/skills/canvas-onboard-harness/SKILL.md`, `harness/skills/validate-canvas-change/SKILL.md` |
| Known defects / current check bindings | `harness/knowledge/known-defects.md`, `harness/validate/validation.yaml` |

## Hard boundaries

- Renderer privileged operations use the typed window.canvasWorkspace preload API; never import Electron, Node, main, or preload into renderer code. Move cross-process contracts toward src/shared; do not add preload-to-renderer imports beyond existing allowlisted debt.
- Keep main code in domain folders and preserve IPC names/API shape during refactors.
- New production TS/TSX files stay at or below 500 lines; existing over-limit baseline files must not grow.
- Tool names/schemas/descriptions ship in the main bundle. Keep descriptions concise and run the bundle gate for tool-surface growth; repeated usage prose belongs in the system prompt.
- Runtime data stays under user runtime/settings locations, not the source tree. Packaged CLI/skills install and repair must use AgentToolingManager and agent-tooling-queue, never a source checkout, pnpm, or global link.
- Driver profiles default to temp/demo/clone. Use real --allow-real-writes only with explicit user intent. Reopening demo without --reset preserves fixtures; reseeding is a reset.
- Read chat-sessions.md before any run/session change: preserve single-flight activation, conversation-owned runtimes and queues, serialized visible approvals, fail-closed pointer changes, attachment/failure persistence, stable rail projections, and stable mounted-target props. Guard details and test references belong there.
- External-role driver rejection after its abort signal is a stopped turn, not a failed turn; follow agent-roles.md.
- Preserve edges as first-class synchronized state and make cross-mindmap transfers atomic with history/edge updates. Full rules and guards: main-domain-modules.md.
- src/shared/canvas.ts owns node/edge shapes. Node capabilities default to plugin nodes with plugin-owned data.payload. Host-union additions are exceptions for main-process facilities the plugin capability registry cannot provide, such as persistent PTY/IPC or dedicated migration paths.
- Runtime capabilities retain read/operate/unsafe tiers and bearer authentication. Only the independently flag-gated page/host eval exceptions expose unsafe operations to external CLI callers; node updates stay limited to title/content. Follow security-posture.md.
- Channel integration stays inert until both its experimental flag and configuration are enabled; keep credentials in local settings/env, never source.

## Tools and acceptance

Before changing agent-tool, IPC, node-type/factory, or app/CLI storage registries, run `node apps/canvas-workspace/harness/tools/describe-canvas.mjs` from the repository root. It checks registry parity; passing it is not a substitute for runtime behavior tests.

Use local validation YAML through the root runner. Iteration uses quick, completed work standard, and relevant performance/release work release. Canvas is not included in root core-only commands.

```bash
pnpm --filter canvas-workspace typecheck
pnpm --filter canvas-workspace test
pnpm --filter canvas-workspace build
```

For interaction or visual changes, use the real-app driver protocol and report the observed scenario. UI showcase baselines are Linux-rendered; follow its README for visual/visual:update rather than comparing fonts across OSes. Dev, isolated-home launch, packaging, and detailed driver command sequences are in package.json and harness/tools/driver/README.md.

Boundary/UI/file-size guards live under src/main/__tests__; storage/plugin/runtime suites and focused domain tests are selected by validation.yaml. Report executed evidence and remaining manual risk.

## Knowledge maintenance

Reuse existing topic owners, preserve facts when extracting prose, and leave trigger-based routes here. Spec records unresolved intended behavior; resolve it into tests/skills/Knowledge and remove obsolete intent. Its surface definition is shared with the engine's harness/spec/README.md. Do not grow this entry into another source map or test inventory.
