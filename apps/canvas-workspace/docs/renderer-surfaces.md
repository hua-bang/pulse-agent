# Renderer surface governance

How full-app surfaces (drawers, docks, overlays, modals) are organized in
`src/renderer`, and the rules for adding new ones.

## The two-region model

The workbench has exactly two side regions plus a modal tier:

```
┌─────────┬──────────────┬──────────────────────────────┬───────────┐
│ Sidebar │ Reference    │ Canvas                       │ Chat      │
│ (nav)   │ Drawer       │   + canvas chrome            │ Panel     │
│         │ (left,       │     (floating toolbar,       │ (right,   │
│         │  in-flow)    │      zoom, fullscreen chip)  │  in-flow) │
│         │              │                              ┆←RightDock │
│         │              │                              ┆ (overlay) │
└─────────┴──────────────┴──────────────────────────────┴───────────┘
                 modal tier: settings drawers, command palette,
                 app-shell dialogs / toasts (above everything)
```

- **Left region — reference.** `ReferenceDrawer` is the only left-side
  container: pinned nodes, URL references, previews. New "look things up
  while working" surfaces belong here, not in a new drawer.
- **Right region — chat + work output.** Two cooperating containers:
  - `ChatPanel` (in-flow flex column, resizes the canvas) — conversation.
  - `RightDock` (`components/RightDock`) — the **tabbed** fixed-overlay
    panel hosting every right-side *preview* surface: artifact tabs
    (`components/artifacts/ArtifactTabView`) and the link tab
    (`components/LinkDrawer` → `LinkTabView`). `DockStore` owns the tab
    policies:
    - artifact tabs are deduped by `(workspaceId, artifactId)` — opening
      an already-open artifact re-activates its tab;
    - at most ONE link tab exists — a new intercepted link replaces its
      URL (every `<webview>` owns a guest renderer process, so stacking
      one per URL would leak processes);
    - closing the active tab activates its right neighbour; the dock
      slides away when the last tab closes; `ESC` closes the active tab,
      the strip's trailing `×` closes the whole dock;
    - tab contents stay mounted and hide via `visibility` (never
      `display: none` — Electron detaches a `<webview>`'s guest when its
      layout collapses; artifacts keep scroll/render state).
    The dock is non-modal: no backdrop, canvas stays interactive.
- **Modal tier.** Settings drawers (`SettingsDrawer` shell), the command
  palette, and app-shell dialogs/toasts. These are modal with backdrops
  and sit above both side regions.

## Rules

1. **No new top-level drawer containers.** A new right-side preview
   surface is a new tab kind: add it to `DockTab` in
   `RightDock/dock-store.ts` and render its view from the `RightDock`
   pane switch — the dock provides positioning, the tab strip, width
   drag + persistence, ESC, slide animations and layering. Candidates:
   terminal output, diff views. Reference-style surfaces extend
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
| `--layer-interaction-shield` | 1800 | drag shield over webviews |
| `--layer-modal` | 1900 | settings drawers |
| `--layer-palette` | 2000 | command palette |
| `--layer-dialog` | 2050 | app-shell confirm dialogs |
| `--layer-toast` | 2100 | app-shell toasts |

Known stragglers not yet on the scale (anchored popovers, lower risk):
`NodeContextMenu` (1000), `FileNodeBubbleMenu` (9000), and various
chat-internal overlays. Migrate them opportunistically when touched.

## History

This structure came out of a 2026-06 container cleanup, in two steps:

1. Previously the artifact preview, link preview and chat panel were
   three unrelated containers, each with its own resize/ESC/animation/
   z-index code, and the artifact drawer (z 100) rendered *below* the
   floating toolbar (z 500). They were unified behind a single
   `RightDockPanel` shell with one-panel-at-a-time exclusivity.
2. The dock was then tabbed: exclusivity ("a new preview evicts the
   previous one") became "a new preview opens a tab"; `DockCoordinator`
   grew into `DockStore` (tab list + active pointer) and the per-panel
   shell became the single tabbed `RightDock` container.
