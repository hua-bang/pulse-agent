# Renderer Module Migration History (through 2026-10-07)

Historical migration notes and intermediate pressure-point measurements extracted from [README.md](../README.md) after `check-renderer-structure` reached `0 target gaps`, `0 boundary errors`, and `0 module cycles` on 2026-10-07.

## Starting context

Before the module-first migration, the renderer grouped most React code under `components/`, while feature state and coordination were split between root `hooks/`, `views/`, and `utils/`. The migration established `modules/`, consolidated each product capability's visual and non-visual implementation under its owner module, and removed legacy feature roots (`views/`, `agent-chat/`, `editor/`).

## Completed component and module extractions

- Chat visual modules use owner folders with `index.tsx`, `index.css`, local controllers, types, and tests.
- ChatToolCalls owns its complete 297-line collapsed/live/result/status tool presentation stylesheet instead of carrying a four-line patch beside 293 parent-owned lines; ChatMessage CSS was reduced from 945 to 651 lines.
- MarkdownContent provides one dangerous-HTML rendering interface for user, completed assistant, and streaming assistant bodies. It owns 338 lines of Markdown/code/highlight/Mermaid/GFM CSS, reducing ChatMessage CSS to 312 lines of message toolbar/editor/image/session/role presentation.
- ChatEmptyState follows the owner-folder convention and owns its 86-line entrance, logo, greeting, and quick-action CSS; ChatView no longer owns the empty experience's presentation.
- RelayBar follows the owner-folder convention and owns 80 lines of multi-role queue, speaking/handoff, pulse, and stop-control CSS.
- ChatTurnMeta follows the owner-folder convention and owns 163 lines of turn outcome, retry/error details, and captured-context CSS; ChatView retains only genuinely cross-chat mention/attachment/accessibility rules.
- ChatMessages owns its live-region status CSS, while ChatClarificationCard follows the owner-folder convention and owns its sticky/card/error presentation. Both stylesheets remain below 500 lines.
- Chat runtime, sessions, target coordination, attachments, mentions, and composer state no longer live in one flat component hooks directory.
- ModelSwitcher lives behind `modules/models/index.ts`, independent from Chat internals; its status/selection hook is owned by the same public interface and shared by Chat and Settings. The MCP App host/provider live in `modules/mcp-apps`; Chat consumes both through their public interfaces.
- RightDock has a framework-free store interface and strong interface-level tests; its size alone is not a reason to split it.
- `i18n/messages.ts` is a data source of truth, not a module-depth problem.
- Canvas document history, external merge, core transactions, and content materialization live behind `modules/canvas/index.ts`; the React adapter is `modules/canvas/document/useCanvasDocument.ts`.
- Mindmap geometry, immutable tree edits, cross-node transfer, and PNG export live under `modules/canvas/mindmap/`; root utils no longer own mindmap behavior. Layout and transfer have interface-level regression tests.
- Canvas viewport, gesture, selection, keyboard, search, paste, and drawing hooks live under `modules/canvas/runtime/`; Dock consumes the viewport interface through `modules/canvas/index.ts`. The cross-module gesture-motion signal lives in `shared/canvasMotion.ts` for UI, note, and iframe consumers.
- The iframe rendered surface is a 53-line composition over owner-local toolbar and content modules; URL webview queued/error/discarded states and HTML/stream frames no longer share one 486-line visual implementation.
- Edge styling is a 257-line positioned panel over an owner-local option renderer and shared preview geometry; option selection is tested through its stroke/cap command interface.
- CommandPalette is a 240-line keyboard surface over a pure 115-line search projection and an owner-local row renderer; node match ordering, command aliases, and disabled filtering are tested independently of React.
- FloatingToolbar is a 71-line composition over owner-local panel toggles, tool modes, node creation, terminal, shape, Agent Team, and plugin controls. Node-action mapping and plugin manifest projection are tested at their interfaces; optional plugin discovery no longer runs inside the toolbar composition root.
- TerminalNodeBody is a ~72-line visual mount over an owner-local terminal runtime hook. PTY lease ownership, xterm lifecycle, snapshot persistence, refitting, shortcut arbitration, and coding-agent mention hints remain covered by component-level lifecycle regressions.
- ShapeNodeBody owns only its 193-line SVG/text editing surface; the 141-line style picker and its CSS live in a child owner folder. A focused interaction test pins style patching without coupling to picker internals.
- CanvasEdgesLayer is a 169-line projection/marker/preview layer over a 128-line owner-local `CanvasEdgePath`; per-edge hit targets, focus opacity, selection underlay, handles, caps, and stroke rendering remain covered by SVG and memo-comparator tests.
- CanvasRootView is a ~270-line visual root with its 104-line contract kept separately.
- CanvasSurface is a ~253-line render implementation with its documented 133-line node/edge/gesture integration contract separated beside it.
- CanvasOverlays is a ~250-line lazy overlay composition with its 82-line contract beside it.
- DefaultCanvasNode is a ~275-line shell/header composition over a 143-line owner-local `CanvasNodeBody`.
- ReferenceCanvasNode, NodeResizeHandles, CanvasNodeHeader, and CanvasNodeBody follow the owner-folder convention and own their respective stylesheets.
- TopicPill keeps its focus/edit/IME/keyboard state machine together in a ~270-line visual module; add/fold controls and their styles are isolated in an owner-local 65-line `TopicActions` surface.
- Coding-agent session bindings, launch command planning, and team auto-resume backoff live behind `modules/coding-agent/index.ts`; AgentNodeBody and its child surfaces (`AgentTeamManaged`, `AgentTerminal`, `AgentRestart`) follow owner-folder conventions.
- ReferenceDrawer child surfaces (`ArtifactsPicker`, `ReferencePreviews`, `ReferenceEmptyState`, `ReferenceEntryList`, `ReferencePicker`, `ReferenceUrlEditor`, `ReferenceDrawerToolbar`) follow the owner-folder convention.
- `components/icons/index.tsx` is a 12-line export surface over icon family implementations.

## Snapshot of pressure points (measured 2026-09-04)

| Area | Evidence | Main friction |
|---|---|---|
| Canvas document | Canvas visual entry ~19 lines over a ~433-line controller; node gesture adapter ~48 lines; drawing gesture adapter ~105 lines; document adapter ~338 lines plus host feedback adapter ~85 lines and owner-local history/merge/command modules | the controller exposes only keyboard ownership and typed RootView props; persistence scheduling remains in the React document adapter; node drag/resize/snap/render-order plus edge/shape/marquee mutual exclusion and post-commit selection cross grouped interfaces |
| Coding-agent session | `AgentNodeBody/useAgentNodeController.ts` ~496 lines; owner terminal ~375 lines; activation adapter ~142 lines; command/binding policy ~186 lines | setup-form state remains in the React adapter; owner/mirror/read-only terminal mounts, PTY lease/persistence, launch/resume binding, Codex recovery, and team auto-resume now have owned interfaces |
| Chat sessions rail | rail composition ~275 lines / owner CSS 386; session item ~251 / owner CSS 219 | session grouping/search/collapse/preview pagination remain in the rail owner, while each session row owns selection/status, pin/rename/delete state, responsive actions, and styles under `ChatSessionRailItem/index.tsx|index.css` |
| Chat surface | ChatView composition ~161 lines / surface CSS 420; ChatInputAttachments ~108 / owner CSS 117 | pending attachment preview/status/retry/remove/lightbox markup and its byte-identical styles share an owner folder; ChatView keeps cross-surface mention DOM-contract, message-media, accessibility, and resize rules |
| Agent Team workspace | `modules/agent-team/components/AgentTeamFrame/index.tsx` ~294 lines; frame model adapter ~179 lines; selection adapter ~143 lines; frame presentation ~114 lines; public model/projection ~436 lines; controller ~190 lines | snapshot/canvas-node projection, task/agent/artifact selection, stale reconciliation, phase copy, counts, cwd fallback, details, and action eligibility live behind owner interfaces |
| Artifacts | ChatInlineVisual entry ~106 lines over runtime/actions/body interfaces ~120/~71/~78 lines and tested promotion policy ~29 lines; owner CSS 355; ArtifactTabView ~263 / 160; ChatArtifactCard ~115 / 121 | all product visuals follow owner folders; streaming iframe morph/height protocol, Mermaid rendering, concurrent artifact promotion, Open/Copy/Pin commands, and final render selection have separate owner interfaces |
| Workspace graph | `GraphPage/index.tsx` ~232 lines; GraphToolbar/Search visual modules ~158/~176 lines with owner CSS; ForceGraph adapter ~192 lines; pure graph model ~200 lines | the page composes graph data, selection, and viewport state; toolbar owns layout controls/menu focus, Search owns shortcut/IME/listbox interaction, and ForceGraph owns third-party drawing/layout calls behind tested interfaces |
| Workspace node detail | NodeDetailDocument CSS ~343 lines; Header 120; Inspector 49; RelationEditor 175; ContextRail 85; Supplementary 75; CanvasPreview 73; SaveError 21 lines | every existing node-detail sub-surface follows owner folders; the remaining document CSS is shared page/dock/rich layout and responsive composition |
| Workspace node cards | KnowledgeNodeCard CSS 143; CardShell CSS 71; NodeCardPreview CSS 218 lines | preview, interactive wrapper, identity/footer/tags/actions, hover/active, and reduced-motion behavior all follow owner folders |
| Workspace node filters | `NodeFilters/index.tsx` ~295 lines; owner CSS 238 lines | search, active scopes, workspace/type/tag popovers, counts, hover/active and reduced-motion behavior follow the owner-folder convention |
| Workspace node tags | `NodeTagEditor/index.tsx` with owner CSS 86 lines | removable tags, picker options, create, empty, and error presentation follow the owner-folder convention |
| Workspace nodes page | `NodesPage/index.tsx` ~178 lines; owner controller ~214 lines; pure filtering/AI-scope model ~123 lines; owner CSS 160 lines | the page only composes header, filters, cards, and selection bar; controller owns data/filter/selection/pagination effects |
| Settings | MCP manager ~370 lines with draft codec ~112 and server form/list 144/184; PluginsManager ~442 lines / owner CSS 67; shared config chrome 438 lines | MCP and plugin bridges remain separate product adapters over shared form/list chrome |
