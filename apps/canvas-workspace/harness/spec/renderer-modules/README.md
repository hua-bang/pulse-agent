# Renderer Module Architecture

Status: planned target; current renderer paths remain authoritative until each
migration phase lands. This spec does not authorize a big-bang directory move.

## Why this exists

The renderer currently groups most React code under `components/`, while
feature state and coordination are split between root `hooks/`, `views/`, and
`utils/`. The migration has established `modules/canvas/`, consolidated Chat
under `modules/chat/`, and started the coding-agent session seam. The earlier Chat architecture
migration proved that owner-local folders, one-way imports, and small public
entry points improve locality, but it also exposed the next navigation
problem: placing feature folders beside `components/` would flatten the
renderer root again.

The target is module-first. A product capability owns its visual and
non-visual implementation together. Root `components/` is reserved for visual
infrastructure with no product-domain meaning.

## Current structure

```text
src/renderer/src/
├── app/
│   └── shell/         # providers, routes, Workbench, Sidebar composition
├── modules/
│   ├── canvas/        # document state, transactions, history, external merge
│   ├── chat/          # Chat visuals + runtime/session/target logic
│   ├── coding-agent/  # AgentNodeBody visuals + session policy/runtime
│   ├── agent-team/    # workspace projection/DAG model + frame visuals
│   ├── workspace-nodes/ # graph/detail/list routes + public data hooks/model
│   ├── mcp-apps/      # MCP App host/provider independent of Chat
│   ├── models/        # reusable model selection surface
│   ├── scheduled/     # scheduled routes, run notifications, Chat integration
│   ├── artifacts/     # chat renderers + independently lazy dock tab
│   ├── plugin-market/ # listing state, route, dialogs, brand assets
│   ├── skills/        # lazy skill library/editor route
│   ├── note-editor/   # editor runtime/extensions + owner-local visual modules
│   ├── settings/      # distinct model/role/MCP/plugin settings under one owner
│   ├── node-mentions/ # shared leaf picker used by canvas/terminal/agent modules
│   └── dock/          # tab/session state, pane visuals, terminal/reference hosts
├── components/        # domain-free icons/ui only
├── platform/
│   └── browser/       # webview lifecycle, URL, guest-input and launch adapters
├── hooks/             # domain-free overlay geometry and keyboard behavior
├── types/             # cross-renderer contracts
├── utils/             # pure helpers, some still feature-specific
├── i18n/
└── app/App/         # application root composition + route projection
```

Current healthy properties:

- Chat visual modules use owner folders with `index.tsx`, `index.css`, local
  controllers, types, and tests.
- ChatToolCalls now owns its complete 297-line collapsed/live/result/status
  tool presentation stylesheet instead of carrying a four-line patch beside
  293 parent-owned lines; ChatMessage CSS is reduced from 945 to 651 lines.
- MarkdownContent provides one dangerous-HTML rendering interface for user,
  completed assistant, and streaming assistant bodies. It owns 338 lines of
  Markdown/code/highlight/Mermaid/GFM CSS, reducing ChatMessage CSS to 312
  lines of message toolbar/editor/image/session/role presentation.
- ChatEmptyState now follows the owner-folder convention and owns its 86-line
  entrance, logo, greeting, and quick-action CSS; ChatView no longer owns the
  empty experience's presentation.
- RelayBar now follows the owner-folder convention and owns 80 lines of
  multi-role queue, speaking/handoff, pulse, and stop-control CSS.
- ChatTurnMeta now follows the owner-folder convention and owns 163 lines of
  turn outcome, retry/error details, and captured-context CSS; ChatView retains
  only genuinely cross-chat mention/attachment/accessibility rules.
- ChatMessages now owns its live-region status CSS, while
  ChatClarificationCard follows the owner-folder convention and owns its
  sticky/card/error presentation. Both stylesheets remain below 500 lines.
- Chat runtime, sessions, target coordination, attachments, mentions, and
  composer state no longer live in one flat component hooks directory.
- ModelSwitcher now lives behind `modules/models/index.ts`, independent from
  Chat internals; its status/selection hook is owned by the same public
  interface and shared by Chat and Settings. The MCP App host/provider live in `modules/mcp-apps`; Chat
  consumes both through their public interfaces.
- RightDock already has a framework-free store interface and strong
  interface-level tests; its size alone is not a reason to split it.
- `i18n/messages.ts` is a data source of truth, not a module-depth problem.
- Canvas document history, external merge, core transactions, and content
  materialization now live behind `modules/canvas/index.ts`; the React adapter
  is `modules/canvas/document/useCanvasDocument.ts`.
- Mindmap geometry, immutable tree edits, cross-node transfer, and PNG export
  live under `modules/canvas/mindmap/`; root utils no longer own mindmap
  behavior. Layout and transfer have interface-level regression tests.
- Canvas viewport, gesture, selection, keyboard, search, paste, and drawing
  hooks live under `modules/canvas/runtime/`; Dock consumes the viewport
  interface through `modules/canvas/index.ts`. The cross-module gesture-motion
  signal lives in `shared/canvasMotion.ts` for UI, note, and iframe consumers.
- The iframe rendered surface is a 53-line composition over owner-local
  toolbar and content modules; URL webview queued/error/discarded states and
  HTML/stream frames no longer share one 486-line visual implementation.
- Edge styling is a 257-line positioned panel over an owner-local option
  renderer and shared preview geometry; option selection is tested through
  its stroke/cap command interface.
- CommandPalette is a 240-line keyboard surface over a pure 115-line search
  projection and an owner-local row renderer; node match ordering, command
  aliases, and disabled filtering are tested independently of React.
- FloatingToolbar is a 71-line composition over owner-local panel toggles,
  tool modes, node creation, terminal, shape, Agent Team, and plugin controls.
  Node-action mapping and plugin manifest projection are tested at their
  interfaces; optional plugin discovery no longer runs inside the toolbar
  composition root.
- TerminalNodeBody is a ~72-line visual mount over an owner-local terminal
  runtime hook. PTY lease ownership, xterm lifecycle, snapshot persistence,
  refitting, shortcut arbitration, and coding-agent mention hints remain
  covered by the existing component-level lifecycle regressions.
- ShapeNodeBody now owns only its 193-line SVG/text editing surface; the
  141-line style picker and its CSS live in a child owner folder. A focused
  interaction test pins style patching without coupling to picker internals.
- CanvasEdgesLayer is a 169-line projection/marker/preview layer over a
  128-line owner-local `CanvasEdgePath`; per-edge hit targets, focus opacity,
  selection underlay, handles, caps, and stroke rendering remain covered by
  the existing SVG and memo-comparator tests.
- CanvasRootView is a ~270-line visual root with its 104-line contract kept
  separately. The contract now names the actual focus, context-menu, mouse,
  edge, node-action, search, marquee, and palette interfaces instead of
  flattening them through `any`.
- CanvasSurface is a ~253-line render implementation with its documented
  133-line node/edge/gesture integration contract separated beside it; the
  tested transform transition and overview-class policies remain unchanged.
- CanvasOverlays is a ~250-line lazy overlay composition with its 82-line
  contract beside it; edge projection, motion parking, empty/context states,
  bottom chrome, command palette, and find bar keep their existing order and
  eight focused policy tests.
- DefaultCanvasNode is a ~275-line shell/header composition over a 143-line
  owner-local `CanvasNodeBody`. Node-type dispatch now owns the existing
  coding-agent, note, frame, iframe, terminal, and text lazy boundaries in
  one place without exposing them to the node shell.
- ReferenceCanvasNode now follows the owner-folder convention and owns its
  253-line reference shell/embedded-preview stylesheet; the parent node CSS
  no longer owns reference-only source-pill, missing-state, drag-overlay, or
  nested preview rules.
- NodeResizeHandles now follows the owner-folder convention and owns its
  169-line eight-direction/default/floating/Frame handle stylesheet; the
  parent CanvasNodeView CSS no longer defines resize geometry.
- CanvasNodeHeader now follows the owner-folder convention and owns its
  356-line header, badge, title, status, action, and overview-action CSS; the
  parent CanvasNodeView stylesheet is reduced to node shell/type/focus and
  fullscreen rules.
- CanvasNodeBody now owns 440 lines of file/iframe/image/shape/mindmap/group
  outer-shell and nested header/body styling alongside its node-type dispatch.
  CanvasNodeView's remaining 315-line CSS is limited to the common node shell,
  selection/motion/focus feedback, overview outline, and fullscreen behavior.
- TopicPill keeps its focus/edit/IME/keyboard state machine together in a
  ~270-line visual module; add/fold controls and their styles are isolated in
  an owner-local 65-line `TopicActions` surface.
- Coding-agent session bindings, launch command planning, and team auto-resume
  backoff now live behind `modules/coding-agent/index.ts`; AgentNodeBody and
  its owner-local tests/styles have moved into the same module.
- Coding Agent setup is split into an 84-line picker composition, CLI
  availability/install guidance, and a launch form; each child owns its CSS
  and tests while the session controller remains independent of visuals.
- AgentTeamManaged now follows the owner-folder convention and owns its
  188-line lead summary/facts/command/terminal-button stylesheet; shared
  AgentNodeBody CSS no longer carries Team-managed presentation.
- AgentTerminal now follows the owner-folder convention and owns 242 lines of
  running info-strip, xterm panel, loading overlay, halo, and agent-mark CSS;
  terminal lifecycle remains behind the coding-agent session interfaces.
- AgentRestart now follows the owner-folder convention and owns 161 lines of
  saved-config, warning, action-link, and detail CSS. AgentNodeBody's remaining
  373-line stylesheet is limited to shared card/body/status/footer controls.
- Canvas visuals and remaining node bodies now live under `modules/canvas`.
  Feature node bodies may be composed by Canvas, but shared mention UI and
  textarea mention behavior live behind `modules/node-mentions/index.ts`, and
  pure knowledge-node predicates live in leaf/shared seams so those features
  never depend back on Canvas and create a module cycle.
- Note editor runtime, interaction state, extensions, image handling, keyboard
  ownership, and editor hooks live behind `modules/note-editor/index.ts`.
  FileNodeBody remains lazy; the lightweight editor registry is in `shared/`
  because app, Canvas, and Dock all consume it without loading Tiptap.
- Dock consumers use `shared/dockPort.tsx`; Dock owns the concrete store and
  may compose product panes without those product modules depending back on
  Dock. Pure tab/split/content policy lives under `shared/dock/`, and embedded
  webview lifecycle lives under `platform/browser/`.
- ReferenceDrawer's ArtifactsPicker now follows the owner-folder convention
  and owns its 86-line scope/list/action popover CSS; the drawer root no longer
  owns artifact-only presentation.
- ReferencePreviews now follows the owner-folder convention and owns 209 lines
  of persistent native/URL/artifact preview slots and card footer CSS. Webview
  keep-alive layering remains inside the same preview module and focused test.
- ReferenceEmptyState now follows the owner-folder convention and owns its
  68-line empty icon, selected-node hint, and muted fallback CSS.
- ReferenceEntryList now follows the owner-folder convention and owns 120
  lines of list-row, active, metadata, type, and remove-action CSS.
- ReferencePicker now follows the owner-folder convention and owns 340 lines
  of workspace selection, search/results, grouped node-type, and picker-item
  CSS. ReferenceDrawer's remaining root stylesheet is 310 lines.
- ReferenceUrlEditor now follows the owner-folder convention and owns its
  62-line URL dialog/form/error/action CSS; the drawer root stylesheet is
  reduced to 248 lines.
- ReferenceDrawerToolbar now follows the owner-folder convention and owns 75
  lines of toolbar/action/anchor/popover-shell CSS. ReferenceDrawer's root CSS
  is now 173 lines of drawer/header/content/animation layout only.
- The renderer application root lives at `app/App/`: route projection is a
  pure tested model and workspace mutation feedback is isolated in an
  app-owned command hook. `main.tsx` imports it directly; no root App barrel
  remains, and lazy route boundaries are unchanged.
- Workspace manifest/selection state lives under `app/workspaces/`; the
  `WorkspaceEntry`/`FolderEntry` data contract is in `shared/workspaces.ts`
  so product modules consume a downward dependency instead of importing app.
- Workspace visibility and Canvas keyboard ownership contexts live in
  `shared/workspaceActivity.tsx`; Canvas provides them while Agent Team,
  coding-agent, note-editor, and Dock consume the downward shared port.
- Cold-start link draining, forwarded webview shortcuts, and guest pointer
  shielding live under `platform/browser`; root hooks now contain only
  domain-free overlay positioning, dismissal, and keyboard behavior.
- `components/icons/index.tsx` remains the stable public interface; canonical
  Canvas node glyphs plus brand, status, action, and workspace glyphs are
  implemented as a few real families. Consumers did not change; the barrel is
  now a 12-line export surface instead of a 398-line implementation file.

Current pressure points, measured on 2026-09-04:

| Area | Evidence | Main friction |
|---|---|---|
| Canvas document | Canvas visual entry ~19 lines over a ~433-line controller; node gesture adapter ~48 lines; drawing gesture adapter ~105 lines; document adapter ~338 lines plus host feedback adapter ~85 lines and owner-local history/merge/command modules | the controller exposes only keyboard ownership and typed RootView props; persistence scheduling remains in the React document adapter; node drag/resize/snap/render-order plus edge/shape/marquee mutual exclusion and post-commit selection cross grouped interfaces |
| Coding-agent session | `AgentNodeBody/useAgentNodeController.ts` ~496 lines; owner terminal ~375 lines; activation adapter ~142 lines; command/binding policy ~186 lines | setup-form state remains in the React adapter; owner/mirror/read-only terminal mounts, PTY lease/persistence, launch/resume binding, Codex recovery, and team auto-resume now have owned interfaces |
| Agent Team workspace | `modules/agent-team/components/AgentTeamFrame/index.tsx` ~294 lines; frame model adapter ~179 lines; selection adapter ~143 lines; frame presentation ~114 lines; public model/projection ~436 lines; controller ~190 lines | snapshot/canvas-node projection, task/agent/artifact selection, stale reconciliation, phase copy, counts, cwd fallback, details, and action eligibility live behind owner interfaces; Frame now owns controller commands, confirmation/gate actions, and visual composition |
| Workspace graph | `GraphPage/index.tsx` ~449 lines; owner CSS 255 lines; ForceGraph adapter ~192 lines; pure graph model ~200 lines | Graph now follows the owner-folder convention; toolbar/search visual state remains in the page while projection/search/highlight and third-party ForceGraph drawing/layout/viewport calls have separate tested interfaces |
| Workspace node detail | NodeDetailDocument CSS ~343 lines; Header 120; Inspector 49; RelationEditor 175; ContextRail 85; Supplementary 75; CanvasPreview 73; SaveError 21 lines | every existing node-detail sub-surface follows owner folders; the remaining document CSS is shared page/dock/rich layout and responsive composition, while the bidirectional markup/style contract reads every owner stylesheet |
| Workspace node cards | KnowledgeNodeCard CSS 143; CardShell CSS 71; NodeCardPreview CSS 218 lines | preview, interactive wrapper, identity/footer/tags/actions, hover/active, and reduced-motion behavior all follow owner folders; the temporary shared `NodeCards.css` is removed |
| Workspace node filters | `NodeFilters/index.tsx` ~295 lines; owner CSS 238 lines | search, active scopes, workspace/type/tag popovers, counts, hover/active and reduced-motion behavior follow the owner-folder convention |
| Workspace node tags | `NodeTagEditor/index.tsx` with owner CSS 86 lines | removable tags, picker options, create, empty, and error presentation follow the owner-folder convention; shared workspace-nodes page CSS is reduced from 614 to 527 lines |
| Workspace nodes page | `NodesPage/index.tsx` ~329 lines; owner CSS 201 lines | page shell/header/selection/grid/legacy state follow the owner-folder convention; shared workspace-nodes CSS is 324 lines of tokens, buttons/chips/tags, and detail-page shell |
| Settings | MCP manager ~370 lines; MCP draft codec ~112 lines; server form/list visuals 144/184 lines; Skills/Plugins remain separate managers | MCP bridge mutation remains in its manager adapter; draft conversion and MCP-specific form/list/OAuth/tool visuals now have owner interfaces; no generic ConfigManager was introduced |

Line counts are discovery signals, not the decision rule. Use the deletion
test: a module earns its place when deleting it would spread its complexity
across callers. Deepening should reduce what callers need to know, not merely
move lines into more files.

## Target structure

```text
src/renderer/src/
├── main.tsx
├── app/                       # composition, routing, providers, app shell
│   ├── App/
│   ├── router/
│   ├── providers/
│   ├── shell/
│   └── shortcuts/
├── modules/                   # product capabilities
│   ├── chat/
│   ├── canvas/
│   ├── coding-agent/
│   ├── agent-team/
│   ├── mcp-apps/
│   ├── dock/
│   ├── artifacts/
│   ├── settings/
│   ├── workspace-nodes/
│   ├── scheduled/
│   └── plugin-market/
├── components/                # domain-free visual infrastructure only
│   ├── ui/
│   ├── icons/
│   └── feedback/
├── platform/                  # browser/preload environment adapters
│   ├── canvas-workspace/
│   ├── clipboard/
│   ├── file-system/
│   ├── external-links/
│   └── performance/
└── shared/                    # pure cross-module implementation/contracts
    ├── hooks/
    ├── types/
    ├── utils/
    ├── constants/
    └── i18n/
```

`components/` being public does not mean "used by several modules." It means
the implementation has no product-domain meaning. An MCP App host can be used
by Chat and Dock and still belong to `modules/mcp-apps/`. Reuse crosses that
module's public interface.

## Module shape

Create only the directories a module actually needs:

```text
modules/<name>/
├── index.ts                    # the only cross-module public interface
├── types.ts                    # module-wide contracts, when needed
├── components/                 # owner-local visual modules
│   └── <Name>/
│       ├── index.tsx
│       ├── index.css
│       └── __tests__/
├── runtime/                    # non-visual state/lifecycle, when needed
├── adapters/                   # concrete adapters at real seams
└── __tests__/                  # cross-submodule integration specs only
```

Do not create an adapter for hypothetical variation. One implementation is
not evidence of a seam; production and deterministic in-memory adapters are a
real seam when both are used.

## Dependency direction

```text
main → app → modules → components / platform / shared
```

Rules:

1. `app/` composes modules but does not implement their product behavior.
2. A module imports another module through its `index.ts` interface. A small,
   named secondary entrypoint is allowed only when a measured lazy-loading or
   bundle boundary would be broken by the root barrel (for example Chat's
   `lazy.tsx`, `session.ts`, `completion.ts`, and `floating.ts`).
3. Cross-module dependencies must be acyclic. The lower-level module never
   imports the caller to learn caller-specific types.
4. Root `components/` cannot import a product module.
5. `shared/` cannot import `app/`, `modules/`, `components/`, or `platform/`.
6. `platform/` cannot import `app/`, `modules/`, or visual components.
7. Privileged behavior continues to cross the typed preload bridge; renderer
   code never imports Electron, main, or preload implementation.

Example:

```text
chat ─────→ mcp-apps
dock ─────→ mcp-apps

mcp-apps ─X→ chat
mcp-apps ─X→ dock
```

Chat owns the adapter from `ToolCallStatus` to the MCP App interface. MCP Apps
owns resource loading, CSP, AppBridge lifecycle, and approval. Dock owns its
fullscreen placement adapter.

## Placement decisions

- Product-specific visual or non-visual behavior → owning `modules/<name>/`.
- Domain-free visual primitive used across modules → root `components/`.
- Browser/preload/environment integration → `platform/`, unless it is an
  owner-specific adapter that belongs inside one module.
- Pure cross-module type or helper with no product owner → `shared/`.
- App-wide route/provider/shell composition → `app/`.
- A hook is placed by ownership, not by the fact that it calls React.

## Migration sequence

1. Establish `modules/` while deepening Canvas document state, then combine
   Chat runtime and visuals under `modules/chat/`. This phase is implemented;
   remaining Canvas visuals still migrate incrementally from root components.
2. Deepen coding-agent session lifecycle, then move AgentNodeBody visuals and
   session runtime into `modules/coding-agent/`. The public binding/command/
   retry policy, Codex discovery, mirror runtime, and visual ownership are
   implemented; setup-form state remains the next deepening opportunity.
3. Form an Agent Team workspace model/controller interface before splitting
   AgentTeamFrame visuals and CSS. The workspace task/round projection and DAG
   layout interface, workspace controller/actions, and visual ownership are
   implemented. Selection orchestration and stale-snapshot reconciliation now
   live in a tested owner hook. Frame phase copy, progress, cwd fallback, and
   action eligibility are also a pure presentation projection; remaining
   snapshot-to-frame projection and details now live in an owner model hook;
   Frame remains a sub-300-line command and visual composition root.
4. Extract the Workspace graph model from the ForceGraph adapter. Implemented:
   model projection/search/highlight and the third-party canvas/layout adapter
   are separate; toolbar/search visuals can still become owner-local modules.
5. Move MCP, Skills, and Plugin settings into separate owner modules. MCP now
   owns its draft codec and form/list visuals; Skills and Plugins remain
   intentionally distinct. Do not create a generic ConfigManager whose
   interface mirrors all three domains.
6. Keep the icons barrel stable; split only its internal implementation by a
   few real icon families.
7. Shrink legacy root `hooks/`, `views/`, `types/`, and `utils/` only as each
   owner migration supplies a real destination.

Every phase must keep the app buildable and preserve lazy-loading, IPC,
persistence, and visual behavior. Avoid import-compatibility barrels that make
both old and new structures permanent.

## Directory health

The local skill
`harness/skills/check-renderer-structure/SKILL.md` owns the repeatable audit.
Its detector reports:

- current top-level and component-group inventory;
- business groups still living in root `components/`;
- feature roots still beside `components/`;
- flat component files that lack owner folders;
- visual, logic, and CSS size pressure;
- cross-module internal imports and upward imports once `modules/` exists;
- cross-module dependency cycles for relative imports;
- tests and styles that appear separated from their owner.

Default mode is read-only and migration-aware. Heuristic counts overlap and
do not represent independent defects. Strict mode evaluates this
target and is appropriate only once the caller explicitly asks for target
conformance or the module-first migration has begun. Existing file-size,
import-boundary, UI-reuse, typecheck, and full-test gates remain authoritative;
the structural detector does not duplicate them.

## Acceptance for the target state

- Every product capability has one navigable module root.
- Cross-module imports use public `index.ts` interfaces and form an acyclic
  graph.
- Root `components/` contains only domain-free visual infrastructure.
- Root `hooks/`, `types/`, and `utils/` contain only truly shared code.
- Owner-specific CSS and tests are colocated.
- Composition roots remain composition roots; product state machines do not
  migrate into `app/`.
- Structure health strict mode, existing governance tests, typecheck, full
  Canvas tests, build, and proportionate real-app validation pass.
