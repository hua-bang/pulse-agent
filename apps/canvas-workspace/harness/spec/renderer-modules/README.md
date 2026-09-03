# Renderer Module Architecture

Status: planned target; current renderer paths remain authoritative until each
migration phase lands. This spec does not authorize a big-bang directory move.

## Why this exists

The renderer currently groups most React code under `components/`, while
feature state and coordination are split between root `hooks/`, `views/`,
`utils/`, and a first extracted domain folder, `agent-chat/`. The Chat
architecture migration proved that owner-local folders, one-way imports, and
small public entry points improve locality, but it also exposed the next
navigation problem: placing several feature folders beside `components/`
would flatten the renderer root again.

The target is module-first. A product capability owns its visual and
non-visual implementation together. Root `components/` is reserved for visual
infrastructure with no product-domain meaning.

## Current structure

```text
src/renderer/src/
├── agent-chat/        # non-visual Chat runtime/session/target logic
├── components/        # shell + product visuals + shared UI mixed together
├── views/             # route-owned product surfaces
├── hooks/             # generic and product-specific hooks mixed together
├── types/             # cross-renderer contracts
├── utils/             # pure helpers, some still feature-specific
├── i18n/
└── App.tsx
```

Current healthy properties:

- Chat visual modules use owner folders with `index.tsx`, `index.css`, local
  controllers, types, and tests.
- Chat runtime, sessions, target coordination, attachments, mentions, and
  composer state no longer live in one flat component hooks directory.
- ModelSwitcher and the MCP App host are independent from Chat internals.
- RightDock already has a framework-free store interface and strong
  interface-level tests; its size alone is not a reason to split it.
- `i18n/messages.ts` is a data source of truth, not a module-depth problem.

Current pressure points, measured on 2026-09-03:

| Area | Evidence | Main friction |
|---|---|---|
| Canvas document | `hooks/useNodes.ts` ~911 lines, ~29 returned values | transactions, history, persistence, external merge, and file effects share a React-hook seam |
| Coding-agent session | `AgentNodeBody/useAgentNodeController.ts` ~1280 lines | PTY/xterm ownership, provider session recovery, mirror terminals, and form state are interleaved |
| Agent Team workspace | `AgentTeamFrame/index.tsx` ~2232 lines; CSS ~2722 lines; no direct spec | snapshot projection, polling, actions, DAG layout, six visual surfaces, and artifact loading have no testable internal seam |
| Workspace graph | `WorkspaceNodes/GraphPage.tsx` ~771 lines | graph projection/search/highlight and the ForceGraph adapter are inseparable |
| Settings | MCP/Skills/Plugins managers share a flat folder and stylesheet | each domain combines bridge mutation, draft state, and visual implementation |

Line counts are discovery signals, not the decision rule. Use the deletion
test: a module earns its place when deleting it would spread its complexity
across callers. Deepening should reduce what callers need to know, not merely
move lines into more files.

## Target structure

```text
src/renderer/src/
├── main.tsx
├── app/                       # composition, routing, providers, app shell
│   ├── App.tsx
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
2. A module may import another module only through its `index.ts` interface.
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

1. Establish `modules/` while deepening Canvas document state. Move current
   `agent-chat/` and Chat visuals together into `modules/chat/` in the same
   phase so the renderer root does not gain another temporary taxonomy.
2. Deepen coding-agent session lifecycle, then move AgentNodeBody visuals and
   session runtime into `modules/coding-agent/`.
3. Form an Agent Team workspace model/controller interface before splitting
   AgentTeamFrame visuals and CSS. Do not replace one large file with dozens of
   pass-through props.
4. Extract the Workspace graph model from the ForceGraph adapter.
5. Move MCP, Skills, and Plugin settings into separate owner modules. Do not
   create a generic ConfigManager whose interface mirrors all three domains.
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
