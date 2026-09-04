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
│   └── browser/       # embedded webview lifecycle and URL adapters
├── hooks/             # generic and product-specific hooks mixed together
├── types/             # cross-renderer contracts
├── utils/             # pure helpers, some still feature-specific
├── i18n/
└── app/App/         # application root composition + route projection
```

Current healthy properties:

- Chat visual modules use owner folders with `index.tsx`, `index.css`, local
  controllers, types, and tests.
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
- Coding-agent session bindings, launch command planning, and team auto-resume
  backoff now live behind `modules/coding-agent/index.ts`; AgentNodeBody and
  its owner-local tests/styles have moved into the same module.
- Coding Agent setup is split into an 84-line picker composition, CLI
  availability/install guidance, and a launch form; each child owns its CSS
  and tests while the session controller remains independent of visuals.
- Canvas visuals and remaining node bodies now live under `modules/canvas`.
  Feature node bodies may be composed by Canvas, but shared mention UI and
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
- The renderer application root lives at `app/App/`: route projection is a
  pure tested model and workspace mutation feedback is isolated in an
  app-owned command hook. `main.tsx` imports it directly; no root App barrel
  remains, and lazy route boundaries are unchanged.
- Workspace manifest/selection state lives under `app/workspaces/`; the
  `WorkspaceEntry`/`FolderEntry` data contract is in `shared/workspaces.ts`
  so product modules consume a downward dependency instead of importing app.
- `components/icons/index.tsx` remains the stable public interface; canonical
  Canvas node glyphs are implemented as one real family in `nodeTypes.tsx`.
  Consumers did not change and the barrel no longer exceeds the code limit.

Current pressure points, measured on 2026-09-04:

| Area | Evidence | Main friction |
|---|---|---|
| Canvas document | Canvas composition ~496 lines; document adapter ~338 lines plus host feedback adapter ~85 lines and owner-local history/merge/command modules | persistence scheduling remains in the React adapter; save retry, viewport restore, external-create feedback, creation/transfer commands, and transaction interfaces are separated |
| Coding-agent session | `AgentNodeBody/useAgentNodeController.ts` ~496 lines; owner terminal ~375 lines; activation adapter ~142 lines; command/binding policy ~186 lines | setup-form state remains in the React adapter; owner/mirror/read-only terminal mounts, PTY lease/persistence, launch/resume binding, Codex recovery, and team auto-resume now have owned interfaces |
| Agent Team workspace | `modules/agent-team/components/AgentTeamFrame/index.tsx` ~413 lines; selection adapter ~143 lines; frame presentation ~114 lines; public model/projection ~436 lines; controller ~190 lines; all major visuals are owner-local | task/agent/artifact selection, stale-snapshot reconciliation, phase copy, counts, cwd fallback, and action eligibility have tested owner interfaces; remaining frame pressure is top-level workspace composition |
| Workspace graph | `GraphPage.tsx` ~447 lines; ForceGraph adapter ~192 lines; pure graph model ~200 lines | toolbar/search visual state remains in the page; projection/search/highlight and all third-party ForceGraph drawing/layout/viewport calls now have separate tested interfaces |
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
   top-level composition should deepen without dozens of pass-through props.
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
