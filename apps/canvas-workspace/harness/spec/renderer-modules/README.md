# Renderer Module Architecture

Status: active structural contract (`0 target gaps`, `0 boundary errors`, `0 module cycles` since 2026-10-07, enforced in `strict` mode by `check-renderer-structure`); remaining root `hooks/`, `types/`, and `utils/` shrink incrementally as owner migrations supply real destinations. Migration trail and component extraction history: [history/2026-10-07-module-migration.md](history/2026-10-07-module-migration.md).

## Why this exists

The renderer is organized **module-first**: a product capability owns its visual and non-visual implementation together under `src/renderer/src/modules/<name>/`. Root `components/` is reserved for domain-free visual infrastructure (`ui`, `icons`, `feedback`) with no product-domain meaning.

## Current structure

```text
src/renderer/src/
├── app/
│   ├── App/           # application root composition + route projection
│   ├── workspaces/    # workspace manifest/selection state
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
├── shortcuts/         # keyboard shortcut registry and terminal shortcuts
├── shared/            # cross-module helpers and dependency-inversion seams
├── types/             # renderer-only UI types; `types.ts` re-exports src/shared/api
├── utils/             # pure helpers, some still feature-specific
├── config/            # agent registry, terminal theme and link handling
├── constants/         # canvas plugin and interaction constants
├── perf/              # renderer jank and counter monitors
└── i18n/
```

## Key Cross-Module Seams

- **Canvas ↔ Chat:** Canvas depends on Chat, so Chat never imports Canvas. Approval cards show Canvas node previews through `shared/approvalNodePreview.ts` (the app root injects the lazy `modules/canvas/preview` loader there).
- **Dock & Shared Ports:** Product-named `shared/` files (`shared/dockPort.tsx`, `shared/dock/`, `shared/chatTarget.ts`, `shared/workspaceActivity.tsx`, `shared/workspaces.ts`, `shared/canvasMotion.ts`, `shared/fileNodeEditorRegistry.tsx`) are intentional dependency-inversion seams so product modules consume downward contracts without importing `app/` or `modules/dock/` directly. Do not move them into a single module owner without a replacement boundary.
- **Mentions & Predicates:** Shared mention UI and textarea mention behavior live behind `modules/node-mentions/index.ts`, and pure knowledge-node predicates live in leaf/shared seams so feature modules never depend back on Canvas.
- **Line counts are discovery signals, not the decision rule.** Use the deletion test: a module earns its place when deleting it would spread its complexity across callers. Deepening should reduce what callers need to know, not merely move lines into more files.

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

Current variant: `artifacts`, `dock`, `plugin-market`, `scheduled`,
`settings`, `skills`, and `workspace-nodes` keep their private implementation
under `internal/` instead of `components/` and `runtime/`. Both forms keep
implementation behind the module's public entry points: `index.ts` plus any
named secondary entry point that preserves a lazy-loading boundary (for
example `dock/reference.ts` or `settings/app.ts`). Do not rename existing folders only to
match this shape; apply it when a module is restructured for another reason.

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
   named secondary entrypoint is allowed only when a lazy-loading or bundle
   boundary would be broken by the root barrel (for example Chat's
   `lazy.tsx`, `session.ts`, `completion.ts`, and `floating.ts`). Such an
   entrypoint exports symbols that `index.ts` does not, so importing it never
   loads the barrel.
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
do not represent independent defects. Strict mode fails on target gaps,
boundary errors, and module cycles; the standard validation level runs it for
every renderer change. Existing file-size,
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
