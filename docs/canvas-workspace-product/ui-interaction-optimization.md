# Canvas Workspace UI Interaction Optimization

Date: 2026-06-17

## Scope

This audit focuses on the renderer-side product experience for `apps/canvas-workspace`, especially:

- Canvas onboarding and empty workspace entry.
- Node creation surfaces: empty state, floating toolbar, right-click menu, and command palette.
- Sidebar navigation, collapsed state, workspace list, and layer list.
- Canvas node chrome: selected state, hover actions, focus/fullscreen affordances.
- Keyboard and accessibility affordances that are visible from the current implementation.

The product goal is to make Pulse Canvas feel like a local-first workbench where users can quickly resume context, place useful nodes, and move between notes, terminals, web references, and AI without hunting through UI.

## Strengths Already Present

- The canvas already has strong interaction infrastructure: pan/zoom, marquee, snap lines, focus mode, fullscreen nodes, search, command palette, edge editing, and persistent workspace state.
- The command palette is a good power-user surface because it mixes node search and commands.
- Save failures, undo/redo boundaries, external agent-created nodes, and destructive actions already have user-facing feedback.
- The right dock width reservation and layered z-index variables show good care for complex desktop surfaces.

## First Pass Implemented

- Reworked the empty canvas into clearer workflow sections:
  - Start with a project folder or demo.
  - Capture context with notes or web references.
  - Run and ask AI with terminal, AI Chat, or agent nodes.
- Added Terminal creation to the main entry points:
  - Empty canvas.
  - Floating toolbar.
  - Right-click create menu.
  - Command palette.
- Improved collapsed sidebar utility:
  - Keeps AI Chat and Settings reachable without expanding the full sidebar.
- Improved selected node discoverability:
  - Header actions now appear for selected nodes, not only on hover.
- Improved keyboard/accessibility affordances:
  - Toolbar toggle buttons now expose `aria-pressed`.
  - Toolbar, empty-state actions, context menu, and sidebar controls have clearer focus-visible states.
- Replaced symbolic context-menu icons with consistent line icons tied to node type.
- Localized the command palette and high-frequency canvas feedback:
  - Command groups, default sections, placeholders, keyboard hints, and command labels.
  - Create-node, Agent/Agent Team feedback, group/ungroup, wrap-in-frame, connection delete, and mindmap export feedback.
- Added a compact selection toolbar:
  - Shows the current selection count.
  - Exposes fit selection, duplicate, focus, group, wrap in frame, pin as reference, add to chat, and delete without requiring Cmd+K or memorized shortcuts.

## Second Pass Implemented

- Improved Find in Canvas:
  - Localized placeholders, match navigation labels, empty titles, and overflow hints.
  - Localized node-type badges so results match the selected app language.
- Improved Reference Drawer:
  - Localized drawer chrome, pickers, URL editor, empty states, preview actions, and validation errors.
  - Made node-type grouping/search use localized type labels, so Chinese searches can match labels like "笔记" or "网页".
  - Replaced the nested `span role="button"` remove control with a real sibling button in the reference list.
- Improved fullscreen mode chrome:
  - Localized fullscreen chip actions for Reference, AI Chat, and Exit fullscreen.
- Reduced duplicated node-type label wiring:
  - Added a shared renderer-side node type i18n map used by Canvas, Command Palette, Search, and Reference Drawer.

## Third Pass Implemented

- Improved Layers panel:
  - Added an empty state so an empty canvas no longer leaves the Layers region looking broken.
  - Localized Layers title, expand/collapse-all action, rename input label, and frame fallback text.
- Improved node mention picker:
  - Converted result rows to real buttons with `listbox` / `option` semantics.
  - Localized node-type badges and included localized type labels in search matching.
  - Added input labelling and an untitled fallback.
- Improved edge style panel accessibility:
  - Added localized `title` / `aria-label` text for color, width, line style, arrow caps, and delete.
  - Added explicit `type="button"` to dense icon controls.

## Fourth Pass Implemented

- Improved Canvas and Layers state continuity:
  - The app shell now passes the active canvas selection into the Sidebar.
  - Layers rows highlight selected nodes, with a stronger outline for the primary selected node.
  - Selecting a node inside a collapsed frame/group automatically reveals its ancestor chain in Layers.
  - The primary selected layer scrolls into view so canvas selection and layer navigation feel connected.

## Fifth Pass Implemented

- Improved large-canvas Layers navigation:
  - Added a compact Layers search field with localized placeholder, clear action, no-result state, and filtered count.
  - Layer search matches node title, node type, and localized node-type labels.
  - Search results keep matching ancestor branches visible, so nested nodes remain spatially understandable.
  - `ArrowUp` / `ArrowDown` move through visible layer rows from the search field or a focused row.
  - `Enter` from the search field focuses the first visible result, while `ArrowLeft` / `ArrowRight` collapse or expand focused container rows outside search mode.

## Sixth Pass Implemented

- Improved node drag feedback and gesture confidence:
  - Node dragging visuals now appear only after the pointer crosses the drag threshold, so a simple click no longer briefly lifts the card.
  - The interaction shield mounts only after real movement, keeping click and double-click flows on nodes cleaner.
  - Tiny pointer jitter during click selection no longer commits a drag history entry or syncs transient node snapshots.

## Seventh Pass Implemented

- Improved context-menu consistency:
  - Layer context menu actions are now localized in English and Chinese.
  - Layer and edge context menus both use the shared keyboard navigation hook for Arrow/Home/End/Escape behavior.
  - Edge context menu actions now use shared line icons instead of text-symbol glyphs, matching the rest of the canvas menu language.

## Eighth Pass Implemented

- Improved toolbar popover keyboard flow:
  - The shared menu keyboard hook now supports an enabled state, so closed popovers no longer listen for global Escape or arrow keys.
  - Shape picker popover now uses menu semantics and supports ArrowUp/ArrowDown/Home/End/Escape navigation.
  - Plugin node popover now uses the same menu keyboard behavior instead of one-off Escape handling.
  - Shape toolbar buttons gained clearer `aria-label`, `aria-haspopup`, and `aria-expanded` affordances.

## Ninth Pass Implemented

- Improved Figma-style canvas navigation:
  - Added hold-Space temporary hand mode, so users can pan the canvas without leaving Select, Connect, or Shape tools.
  - Space panning is ignored inside inputs, text editors, buttons, menu items, and IME composition so normal typing and control activation keep working.
  - Temporary hand mode now feeds the same pan cursor, iframe shielding, and overlay suppression path as the permanent hand tool.
  - The shortcuts dialog and Pan toolbar tooltip now mention `Space + Drag` discovery.

## Tenth Pass Implemented

- Improved selected-object action flow:
  - Selection Toolbar now exposes `role="toolbar"` with a localized label so assistive tech announces it as a grouped action surface.
  - Arrow keys and Home/End move focus across enabled Selection Toolbar buttons.
  - Toolbar arrow navigation now consumes those keys, preventing accidental canvas nudge while the toolbar itself has focus.

## Eleventh Pass Implemented

- Improved shape style editing:
  - Shape style popover now uses menu semantics with grouped fill, stroke, and stroke-width options.
  - Arrow keys and Home/End navigate shape style options through the shared menu keyboard hook.
  - Escape and outside-click dismissal now use the same shared overlay behavior as toolbar and context menus.
  - Shape style trigger, section labels, and option labels are localized in English and Chinese.

## Twelfth Pass Implemented

- Improved header color popovers:
  - Text color, text background, and frame color triggers are now real buttons with `aria-haspopup` and `aria-expanded`.
  - Text and frame color swatches use menu semantics and `menuitemradio` checked state.
  - Color popovers now share the same Arrow/Home/End/Escape keyboard behavior as shape style and toolbar menus.
  - Shared menu arrow navigation now captures and consumes Arrow/Home/End keys, preventing accidental canvas nudge while a menu is focused.
  - Frame color controls now remain visible on keyboard focus, not only on hover.
  - Text and frame color labels are localized in English and Chinese.

## Thirteenth Pass Implemented

- Improved custom select continuity:
  - Agent Team's coding-agent picker now uses the shared menu keyboard navigation path instead of mouse-only option flow.
  - Agent Team and generic select menus now autofocus the current value when opened, so users resume from their actual selection.
  - Select triggers support ArrowUp/ArrowDown/Home/End to open menus and consume those keys, reducing accidental outer canvas shortcuts.
  - Dropdown Escape, outside-click dismissal, option focus, and option activation now behave more consistently across settings and Agent Team review surfaces.

## Fourteenth Pass Implemented

- Improved Reference Drawer picker flow:
  - Opening the current/other workspace picker now focuses the search field so users can type immediately.
  - ArrowUp/ArrowDown from the search field moves into matching reference results without reaching outer canvas shortcuts.
  - The workspace selector inside the other-workspace picker now supports ArrowUp/ArrowDown/Home/End and autofocuses the selected workspace.
  - Reference result lists use the shared keyboard navigation hook in a scoped mode, so Home/End still edit text while focus is in the search field.
  - Workspace options, reference result rows, and group headers now expose visible keyboard focus states matching hover styling.

## Fifteenth Pass Implemented

- Improved URL reference editor flow:
  - The add-URL popover now behaves as a real form, so Enter submits through the same path as the primary action.
  - Empty URL drafts no longer submit from the keyboard while the Add button is disabled.
  - Escape closes the whole URL popover through the shared capture-phase close behavior, preventing canvas shortcuts from also firing.
  - Closing with Escape, Cancel, or a successful submit restores focus to the URL trigger instead of leaving keyboard focus adrift.
  - Invalid URL errors now connect to the input with `aria-invalid` and `aria-describedby`.

## Sixteenth Pass Implemented

- Improved find-in-canvas result semantics:
  - Search results now render as real buttons with `role="option"` inside a labeled `listbox`.
  - The search input now references the result list and active result with `aria-controls` and `aria-activedescendant`.
  - Result rows expose `aria-selected` and localized option labels, so the current find target is clearer to assistive tech.
  - Keyboard focus on result rows now uses the same visible hover styling as pointer interaction.
  - Pointer hover over result rows stays low-interruption and no longer changes the active camera target unless the row is clicked or focused.

## Seventeenth Pass Implemented

- Improved Command Palette result semantics:
  - Command Palette now presents itself as a labeled dialog with a combobox input and a labeled result listbox.
  - Palette rows now render as real button options with `role="option"` and `aria-selected`, instead of clickable `div` rows.
  - The input now references the active result via `aria-activedescendant`, keeping the search field as the stable typing anchor.
  - Focused result rows share the same selected styling as pointer and arrow-key navigation.
  - Result-row Home/End shortcuts jump to first/last result without stealing Home/End from text editing in the input.

## Eighteenth Pass Implemented

- Improved node mention picker continuity:
  - Node mention search now uses a combobox input linked to a labeled mentionable-node listbox.
  - Active mention options are exposed through `aria-activedescendant` and localized option labels.
  - Arrow navigation keeps the active mention scrolled into view while the input remains the stable typing anchor.
  - Pointer press on an option no longer steals input focus before the click inserts the reference.
  - Focused mention rows share the same selected styling as keyboard and pointer navigation.

## Nineteenth Pass Implemented

- Improved drag and resize gesture feedback:
  - Node drags now expose a lightweight live preview state with current X/Y position, node dimensions, selection count, and free-move status.
  - Node resize gestures now expose live width/height feedback from the first press through the drag.
  - Canvas renders a small inverse-scaled gesture HUD near the active node, so the label remains readable at every zoom level while staying anchored to canvas space.
  - Holding Cmd/Ctrl during drag now visibly switches the HUD into free-move mode, matching the existing snap-disable behavior with clearer feedback.
  - Gesture HUD copy is localized in English and Chinese and remains pointer-transparent so it cannot interrupt canvas manipulation.

## Twentieth Pass Implemented

- Improved sidebar add-menu keyboard flow:
  - The workspace add trigger now exposes menu state through `aria-haspopup`, `aria-expanded`, and `aria-controls`.
  - ArrowDown/ArrowUp on the add trigger opens or enters the menu, matching common command/menu button behavior.
  - Workspace add-menu items now use `role="menuitem"` inside a labeled `role="menu"` container.
  - Escape closes the menu through the shared menu keyboard hook and restores focus to the add trigger.
  - The add-menu label is localized in English and Chinese.

## Twenty-First Pass Implemented

- Improved chat model switcher continuity:
  - The model switcher trigger now exposes menu state through `aria-haspopup`, `aria-expanded`, and `aria-controls`.
  - ArrowDown/ArrowUp on the trigger opens or enters the model menu without requiring pointer interaction.
  - Model choices now use `menuitemradio` semantics with `aria-checked`, so the current model is explicit.
  - Opening the menu autofocuses the active model choice, matching the user's current selection instead of restarting at the top.
  - Escape now closes through the shared menu keyboard path and restores focus to the model trigger; keyboard focus styling now matches hover styling.

## Twenty-Second Pass Implemented

- Improved chat session menu continuity:
  - The chat title/session trigger now exposes menu state through `aria-haspopup`, `aria-expanded`, and `aria-controls`.
  - ArrowDown/ArrowUp on the title trigger opens or enters the session menu.
  - Session menu actions now use menu semantics, with the current session marked through `aria-current`.
  - Opening the menu autofocuses the current session when one is present, keeping navigation anchored to the user's current chat.
  - Escape closes through the shared menu keyboard path and restores focus to the title trigger; keyboard focus styling now matches hover/active styling.

## Twenty-Third Pass Implemented

- Improved Workspace Nodes tag picker continuity:
  - The `+ Tag` trigger now exposes picker state through `aria-haspopup`, `aria-expanded`, and `aria-controls`.
  - The tag picker now behaves as a combobox linked to a labeled listbox with `aria-activedescendant`.
  - ArrowUp/ArrowDown/Home/End move through tag and create-tag options while keeping text input focused.
  - Enter adds the active tag or creates the typed tag; pointer selection no longer steals input focus, so users can keep adding tags.
  - Escape and outside click close the picker through shared overlay behavior, with Escape restoring focus to the `+ Tag` trigger.

## Twenty-Fourth Pass Implemented

- Improved Workspace Graph overflow menu flow:
  - The graph `More` trigger now exposes menu state through `aria-haspopup`, `aria-expanded`, and `aria-controls`.
  - ArrowDown/ArrowUp on the trigger opens or enters the overflow menu.
  - Overflow menu items now use consistent menu semantics and shared Arrow/Home/End/Escape handling.
  - Escape restores focus to the `More` trigger, matching the chat and sidebar menu behavior.
  - Keyboard focus styling now matches hover styling for graph overflow actions.

## Twenty-Fifth Pass Implemented

- Smoothed the Chat Anchors jump menu:
  - The anchors trigger now exposes `aria-haspopup`, `aria-expanded`, and `aria-controls`.
  - ArrowDown/ArrowUp on the trigger opens or enters the anchors menu.
  - The anchors popup now uses menu semantics and the shared Arrow/Home/End/Escape keyboard model.
  - Escape closes the menu and restores focus to the anchors trigger.
  - Anchor menu labels and item titles now use the shared i18n message catalog.
  - Keyboard focus styling now matches hover styling for anchor jump items.

## Twenty-Sixth Pass Implemented

- Improved the editor slash command menu semantics:
  - The slash popup now exposes a localized listbox label instead of an unlabelled floating surface.
  - The active slash command is represented with `aria-activedescendant` and option `aria-selected` state.
  - The hardcoded `BLOCKS` header now uses the shared i18n catalog.
  - Keyboard focus styling now matches hover and active styling for command rows.
  - Existing ProseMirror-owned Arrow/Enter/Escape behavior was preserved so text editing focus remains stable.

## Twenty-Seventh Pass Implemented

- Tightened Workspace Graph search keyboard semantics:
  - The graph search field now behaves as a labeled combobox connected to the results list.
  - Search results now expose a localized listbox label and active option via `aria-activedescendant`.
  - Arrow navigation keeps the active result scrolled into view.
  - Result buttons now have localized option labels and visible keyboard focus styling.
  - Existing Enter-to-jump and Escape-to-close behavior was preserved.

## Twenty-Eighth Pass Implemented

- Improved Reference Drawer picker focus continuity:
  - Current/other reference triggers now expose their open dialog through `aria-controls`.
  - Escape from the picker closes it and restores focus to the trigger that opened it.
  - The cross-workspace selector now exposes its listbox through `aria-controls`.
  - Escape from the workspace selector closes only that selector and restores focus to the selector trigger.
  - The node search input now behaves as a combobox connected to the picker list.

## Twenty-Ninth Pass Implemented

- Smoothed the selected-edge style panel:
  - Edge style chips now expose their option popover through `aria-haspopup` and `aria-controls`.
  - The option popover now uses the shared menu keyboard model with Arrow/Home/End/Escape behavior.
  - Current color, width, stroke style, and arrow cap options now use `menuitemradio` semantics with `aria-checked`.
  - Opening a section autofocuses the currently selected value.
  - Escape or choosing a value closes the section and restores focus to the source chip.
  - Keyboard focus styling now matches hover/active styling for chips and option buttons.

## Thirtieth Pass Implemented

- Closed the final clickable-surface audit findings:
  - Chat tool-call summary and tool-result rows now use real buttons with `aria-expanded`, localized labels, and visible focus states.
  - Right Dock preview tabs no longer nest the close control inside the tab button; close is an independent button with localized labels and focus styling.
  - Artifact cards now separate the open surface from Open/Pin actions, avoiding a button-like card that contains more buttons.
  - Agent Team agent cards now expose agent selection as a real button while keeping the coding-agent selector as an independent control.
  - A final static scan now leaves only expected exceptions: canvas node wrappers used for node selection and modal/backdrop click handling.

## Verification Audit Updated

- Resolved completion-audit test blockers found during full `canvas-workspace` verification:
  - Updated workspace-node/tag/knowledge tests to match the current v2 storage model where canvas nodes already have per-node records before extra metadata is added.
  - Refreshed the file-size governance baseline to the current branch state after the broad UI and workspace-node changes.
  - Re-ran targeted agent/knowledge test files after the expectation update.
- Final Smooth Interaction Pass verification:
  - `pnpm --filter canvas-workspace typecheck`
  - `git diff --check`
  - Full `pnpm --filter canvas-workspace test`

## Priority Recommendations

### P0: Finish Creation Consistency

- Continue checking newly added commands for i18n coverage before merging.
- Keep the node creation inventory synchronized across all entry points. Any new creatable type should appear in toolbar, right-click menu, command palette, and empty-state recommendations when relevant.

### P1: Improve First-Run Guidance

- Replace the generic welcome message with a state-aware checklist:
  - Project folder connected.
  - Model provider configured.
  - Local agent CLI detected.
  - First note or terminal created.
- Make each checklist item actionable and dismissible.
- After a user creates the first node, avoid bringing back onboarding copy unless the workspace becomes empty again.

### P1: Continue Selection Action Polish

- Continue tuning the compact selection toolbar:
  - Consider grouping low-frequency actions behind a menu if the toolbar grows further.
  - Consider a small disabled-state reason for actions that only support a single selected node.
- Keep destructive actions behind existing confirmation behavior.
- Keep the toolbar compact enough that it does not collide with the floating creation toolbar on narrow canvases.

### P1: Tighten Sidebar Information Architecture

- In collapsed mode, consider a small active workspace indicator or tooltip that shows the current workspace name.
- In the expanded sidebar, separate global navigation from workspace management with slightly stronger visual rhythm.
- For the Layers panel, consider recent-layer navigation or pinned layer sections for very large canvases.

### P1: Clarify Agent And AI States

- Distinguish "AI Chat", "Coding Agent", and "Agent Team" more explicitly in labels and empty-state copy.
- Surface setup requirements near the create action: model provider, local CLI, or root folder.
- For agent nodes, expose a stable status strip rather than relying mostly on hover/status dots.

### P2: Add Spatial Navigation Aids

- Add a lightweight overview/minimap or "recent positions" jump list for large canvases.
- Add named layout templates for common work:
  - Feature work: spec, files, terminal, agent.
  - Research: notes, web references, mindmap.
  - Debugging: terminal, failing file, logs, agent.
- Add a "fit selection" visible control when selection exists.

### P2: Accessibility And Keyboard QA

- Run a full keyboard pass over:
  - Sidebar navigation and add menu.
  - Empty-state URL composer.
  - Right-click menu and command palette.
  - Node header actions.
  - Settings and shortcuts dialogs.
- Verify focus trapping for modal/dialog surfaces and reading order for command/search results.
- Add reduced-motion handling for focus mode, menu animation, and toast transitions.

## Visual System Notes

- The current palette is calm and work-focused, which fits a developer workbench.
- Avoid drifting into a decorative landing-page feel on the canvas. Empty states should stay operational and compact.
- Keep cards and controls close to the existing `--radius` / `--radius-lg` scale.
- Prefer meaningful icon+tooltip controls over text-heavy buttons for dense workbench surfaces.

## Suggested Next Iteration

1. Add state-aware first-run checklist items for project folder, model provider, and agent CLI readiness.
2. Add screenshot-based QA for empty canvas, populated canvas, collapsed sidebar, right-click create menu, command palette, and node selection states.
3. Audit remaining hardcoded canvas strings in lower-frequency paths outside Canvas, Command Palette, Search, and Reference Drawer.
4. Consider a lightweight overview/minimap or recent-position jump list for large canvases.
