# Renderer surface governance

How full-app surfaces (drawers, docks, overlays, modals) are organized in
`src/renderer`, and the rules for adding new ones.

## The two-region model

The workbench has exactly two side regions plus a modal tier:

```
┌─────────┬──────────────┬──────────────────────────────┬───────────┐
│ Sidebar │ Reference    │ Canvas                       │ RightDock │
│ (nav)   │ Drawer       │   + canvas chrome            │ ┌───────┐ │
│         │ (left,       │     (floating toolbar,       │ │Chat│▦│🔗│ ← tabs
│         │  in-flow)    │      zoom, fullscreen chip)  │ ├───────┤ │
│         │              │                              │ │ pane  │ │
│         │              │   (canvas reflows: dock      │ └───────┘ │
│         │              │    reserves its width)       │           │
└─────────┴──────────────┴──────────────────────────────┴───────────┘
                 modal tier: settings drawers, command palette,
                 app-shell dialogs / toasts (above everything)
```

- **Left region — Library.** `ReferenceDrawer` (displayed as "Library")
  is the only left-side container: the pinned reference entries (persisted
  per workspace in `references.json`, hydrated/saved by
  `Workbench/useReferenceEntries`), source pickers for current/other
  workspace nodes and URLs, an Artifacts browser
  (`ReferenceDrawer/ArtifactsPicker` — scope filter current workspace /
  all scopes via `artifact:list-all`; clicking a row pins the artifact
  as a reference entry and previews it in-drawer (cross-scope works —
  the preview resolves by the ARTIFACT's storage scope), with
  open-in-dock and pin-to-canvas actions; cross-scope pin-to-canvas is
  disabled because the canvas mirror resolves by the host canvas's
  workspaceId), and previews. New "look things up while working"
  surfaces belong here, not in a new drawer. Division of labor: Library
  = browse/pick sources; Sidebar Layers = this canvas's spatial
  structure tree; the experimental `/nodes` page = full-page knowledge
  nodes management.
- **Right region — `RightDock`** (`modules/dock/internal/RightDock`): ONE tabbed
  panel whose first tab is the **pinned chat**; preview surfaces open as
  additional tabs — artifacts (`modules/artifacts/tab.ts`)
  and the link preview (`modules/dock/internal/LinkDrawer` → `LinkTabView`).
  `DockStore` owns the policies:
  - **the tab strip only renders when a preview tab exists** — chat alone
    looks like a plain chat panel (and the migration was invisible to
    chat-only users);
  - chat is pinned and non-closable; collapsing the dock (strip's `⇥`,
    chat header's close, toolbar chat toggle) keeps every tab alive;
  - chat activity while another tab is visible sets an unread dot on the
    chat tab, cleared on activation;
  - artifact tabs are deduped by `(workspaceId, artifactId)` — opening
    an already-open artifact re-activates its tab;
  - all preview tabs belong to the Dock scope where they were opened;
    switching scope restores its own tab order, focus and comparison layout.
    Global Chat has its own scope, independent of the active Canvas;
  - link tabs are deduped by exact URL within their owning scope.
    They persist their URL, title, favicon, and last active tab in renderer
    local storage, so reopening the app restores that workspace's browser
    session; terminal and other transient preview tabs do not persist;
  - closing the active preview activates its right neighbour, falling back to
    chat. From dock chrome, Escape collapses an active web tab, closes a
    reconstructible content/terminal tab, and leaves pinned chat alone;
    Escape inside a web page remains page-owned;
  - web and terminal tabs can enter comparison with the pinned chat: content
    stays on the left and Pulse AI on the right; ordinary tab selection replaces
    the left, while explicit placement changes the right. Pane focus routes input
    without changing this rule, and closing paired content exits comparison;
  - browser tabs mount lazily on first visibility, so restored hidden tabs and
    a collapsed dock do not create cold guests. Resident tab contents stay
    mounted in the background and hide via `visibility` (never `display: none`
    — Electron detaches a `<webview>` guest when its layout collapses). L3
    Memory Saver may explicitly discard a clean, reloadable frozen guest and
    later restore its URL/scroll; see `dock-browser.md` for that lifecycle plus
    navigation, identity, retention, focus, shortcut, and overflow contracts.

  Layout: the dock is a fixed element on `--layer-dock` that stays
  mounted while collapsed. On workbench routes it reserves its width via
  the `--right-dock-inset` custom property consumed by `.app-body`, so it
  behaves like an in-flow column and page content remains fully visible.
  Nodes and node-detail routes reuse this same chat pane with the global
  agent scope. Their current knowledge node is passed as explicit
  cross-workspace context; the Nodes list starts with no automatic context,
  while Graph remains on the active workspace's chat.
  Workspace ChatPanels remain mounted but hidden while that global instance
  is visible, and the Nodes route itself is kept alive so filters and scroll
  survive a detail-page round trip.
  Global knowledge-node context is read-only by default. AI Summary writes the
  generated summary through the dedicated metadata update path; interactive
  global chat may mutate a selected workspace only through explicit-target
  tools carrying a workspaceId, while the global knowledge context itself
  remains read-only.
  The dedicated `/chat` route hides the dock chat tab to avoid duplicating
  the full-page chat surface. Chat internals stay owned by `Workbench`,
  which portals its per-workspace `ChatPanel` instances into the dock's
  chat pane (`useRightDockChatHost`) — the portal escapes the keep-alive
  router's `display:none` wrapper, so chat state survives route switches.
  Canvas tabs default to read-only in every host. The dedicated `/chat` route
  alone may expose an explicit edit mode backed by the canonical `Canvas`;
  ordinary workspace docks remain read-only and direct editing to the main
  canvas. Route-derived permission is transient and never part of DockStore.
- **Modal tier.** Settings drawers (`ui/Drawer` shell, formerly
  `SettingsDrawer`), the command palette, and app-shell dialogs/toasts (the
  centered ones now share the `ui/Modal` shell). These are modal with
  backdrops and sit above both side regions.

## Local folder previews

`RightDock/FolderDockTab` owns one folder preview tab per Dock scope.
The creation menu opens the workspace-bound root without a picker; an
unbound scope asks once, then reuses its existing folder tab. Opening a
different root replaces the same tab and clears its file selection. Opening one never changes the workspace root or agent cwd.
Selection survives scope switches in memory; folder tabs are not restored
across application restarts. Directory expansion reads one level, explicitly
including hidden files, while existing mention-picker listing defaults remain
unchanged. Refresh reloads expanded directories and the selected preview.
The root header can create files or folders, and each tree row exposes
hover/focus actions for rename and moving to the system Trash; directory rows
also create children. Names are entered inline with Enter/Escape semantics.
Main-process mutations are confined to the opened root (including real-path
checks for parent symlinks), never overwrite an existing entry, and reject
renaming or deleting the root itself. Every mutation passes the existing dirty
draft guard, refreshes the affected directory, and remaps or clears the selected
preview when its path changes.

Read-only source files use the existing highlight.js language set with line numbers;
Markdown switches between rendered content and source, and images reuse the
image preview service. The main-side `file:preview` contract bounds UTF-8 text
reads and rejects non-regular, binary, invalid-encoding and oversized files.
VS Code actions use the existing file helper for either the selected file or
the root folder (click the root breadcrumb to clear file selection first).

The icon-only conversation action delivers an absolute-path file mention
through ChatTarget's `file` insertion, shared by page and dock composers.
Directory rows and the root header expose a hover/focus conversation action.
It uses the same delivery path with `isDirectory`, preserving a folder mention
and absolute path; clicking this action does not toggle directory expansion. It
only updates the draft. First use reveals chat and waits for a same-scope
composer; navigation cancels pending delivery. Busy page targets queue their own insertion; hidden
dock chat is never used as fallback. Guards: `FolderDockTab/__tests__/`,
`RightDock/__tests__/dock-folder-tabs.test.ts`, and the ChatTarget and composer
scope-draft suites.

Local code/text files open directly in a lazy CodeMirror surface. Markdown
defaults to rendered preview; its source toggle opens the same editor. There
is no edit-mode toolbar. A save dot appears only for a dirty draft, and a
floating Undo/Redo pair appears once editor history exists. Find opens a compact
upper-right panel with match options, count, previous/next, and close; replacement
controls are collapsed by default. The panel uses CodeMirror search commands and
its lifecycle, with React controls mounted through the shared Portal. Native
`findNext` selects the search field; live query updates must restore the input
caret/selection and skip navigation during IME composition. Validate sequential
character entry, not only bulk input.

The editor uses CodeMirror core directly plus a small set of legacy stream
modes for common source and config formats. Do not restore `language-data` or
the full React wrapper: both enumerate broad language and editor dependency
trees, inflating total renderer JS and the packaged ASAR even though the editor
itself is lazy. The startup-graph boundary test and bundle/package performance
gates cover both halves of this contract.

The
`DockStore.folderEditor` state owns one draft per scope, retaining it through
workspace unmounts. File/root changes and every tab-close path pass its dirty
check; Save, Discard, and Cancel resolve the deferred transition. Refresh,
external-editor opening, and adding a file to chat use the same check so they
do not silently consume stale on-disk text. These drafts are memory-only.

`fileEditor.save` is registry-owned and handled only inside the file editor
surface. Save uses the byte version returned by `file:preview` and the main
`file:save-preview` operation. Conflicts and write failures retain the draft.
Renderer HMR cannot upgrade the main/preload file service: if the preview
lacks a byte version or `savePreview` is unavailable, show an explicit
restart-required read-only notice instead of silently displaying uneditable
code. The editor preserves BOM and CRLF, and the save operation preserves mode bits
and writes through symlink targets. Guards: `dock-folder-editor.test.ts`,
`FolderDockTab/__tests__/FolderDockTab.test.tsx`, and `file-save.test.ts`.

## Rules

1. **No new top-level drawer containers.** A new right-side preview
   surface is a new tab kind: add it to `RightDock/dock-store.ts` and
   render its view from the `RightDock` pane switch — the dock provides
   positioning, the tab strip, width drag + persistence, ESC, slide
   transitions and layering. Precedent: the terminal tab already works
   this way (`DockTerminalTab` in `dock-store.ts` + `TerminalDockTab.tsx`).
   Remaining candidates: diff views. Reference-style surfaces extend
   `ReferenceDrawer`.
2. **No hardcoded z-index for full-app surfaces.** Take a `--layer-*`
   token from the layering scale in `styles.css`. Stacking that stays
   inside one component (node bodies, menus anchored within a panel)
   keeps local values.
3. **Docks are non-modal; settings are modal.** Backdrops only exist in
   the modal tier.

## Layering scale

Defined in `src/renderer/src/styles.css` (`:root`), low → high:

| Token | Value | Used by |
| --- | --- | --- |
| `--layer-canvas-chrome` | 500 | FloatingToolbar, ZoomIndicator |
| `--layer-canvas-chrome-raised` | 600 | toolbar flyouts (shape picker) |
| `--layer-status-pill` | 950 | MigrationSpinner |
| `--layer-fullscreen-node` | 1000 | fullscreened canvas node (`.canvas-transform`) |
| `--layer-fullscreen-chrome` | 1010 | fullscreen chip |
| `--layer-dock` | 1100 | RightDock (artifact / link previews) |
| `--layer-search` | 1500 | find-in-canvas bar |
| `--layer-note-popover` | 1550 | note slash / mention / selection bubble menus |
| `--layer-interaction-shield` | 1800 | drag shield over webviews |
| `--layer-modal` | 1900 | settings drawers |
| `--layer-palette` | 2000 | command palette |
| `--layer-dialog` | 2050 | app-shell confirm dialogs |
| `--layer-toast` | 2100 | app-shell toasts |

Known stragglers not yet on the scale (anchored popovers, lower risk):
`NodeContextMenu` (1000) and various chat-internal overlays. Migrate them
opportunistically when touched.

## History

This structure came out of a 2026-06 container cleanup, in three steps:

1. Previously the artifact preview, link preview and chat panel were
   three unrelated containers, each with its own resize/ESC/animation/
   z-index code, and the artifact drawer (z 100) rendered *below* the
   floating toolbar (z 500). They were unified behind a single
   `RightDockPanel` shell with one-panel-at-a-time exclusivity.
2. The dock was then tabbed: exclusivity ("a new preview evicts the
   previous one") became "a new preview opens a tab"; `DockCoordinator`
   grew into `DockStore` (tab list + active pointer) and the per-panel
   shell became the single tabbed `RightDock` container.
3. Chat moved in as the pinned first tab (with the strip hidden while
   chat is alone), and the dock switched from pure overlay to reserving
   layout space on the canvas route — making the right region one
   container, symmetric with the left reference area.

## Renderer entry reference

- `src/renderer/src/app/App/index.tsx`: top-level renderer routes, shell, settings, and
  plugin route/nav integration.
- `src/renderer/src/modules/canvas/components/canvas/Canvas/`: canvas surface and interaction wiring.
- `src/renderer/src/app/shell/Workbench/`: mounted workspace state and chat
  portal ownership.
- `src/renderer/src/modules/dock/internal/RightDock/`: tabbed right dock for chat and
  previews (link, artifact, node-detail, canvas-preview, terminal tabs).
  Behavior: `harness/knowledge/dock-browser.md`.
