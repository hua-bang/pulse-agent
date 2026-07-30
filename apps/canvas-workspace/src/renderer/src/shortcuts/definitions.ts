/**
 * THE shortcut table — every keyboard binding in the workbench, declared
 * exactly once. Behavior lives in the hooks that own each `owner` bucket;
 * see `registry.ts` for the matching/formatting API and the rationale.
 */
import type { ShortcutDefinition, ShortcutOwner } from './types';

/**
 * The registry. Order matters: `matchShortcut` returns the first hit, so
 * literal-Ctrl entries are declared before their `mod` neighbours.
 */
export const SHORTCUTS = {
  // ---- Canvas navigation -------------------------------------------------
  'canvas.commandPalette': {
    id: 'canvas.commandPalette',
    owner: 'canvas',
    section: 'canvas',
    descriptionKey: 'shortcuts.canvas.commandPalette',
    bindings: [{ key: 'k', mod: true }],
    // Works from a text field, terminal, or embedded page: this chord
    // has no text-editing meaning, and blocking it made every focused
    // input a keyboard black hole.
    editable: 'allow',
  },
  'canvas.commandPaletteAlt': {
    id: 'canvas.commandPaletteAlt',
    owner: 'canvas',
    section: 'canvas',
    descriptionKey: 'shortcuts.canvas.togglePalette',
    // Ctrl, not Cmd: macOS swallows Cmd+H as "hide application", so the
    // documented Cmd+H never reached the renderer there.
    bindings: [{ key: 'h', ctrl: true }],
    // Works from a text field, terminal, or embedded page: this chord
    // has no text-editing meaning, and blocking it made every focused
    // input a keyboard black hole.
    editable: 'allow',
  },
  'canvas.find': {
    id: 'canvas.find',
    owner: 'canvas',
    section: 'canvas',
    descriptionKey: 'shortcuts.canvas.find',
    bindings: [{ key: 'f', mod: true }],
    // Note cards own their own find flow; the handler re-checks that.
    editable: 'allow',
  },
  'canvas.findNext': {
    id: 'canvas.findNext',
    owner: 'canvas',
    section: 'canvas',
    descriptionKey: 'shortcuts.canvas.findNext',
    bindings: [{ key: 'F3' }, { key: 'F3', shift: true }],
    editable: 'allow',
  },
  'canvas.cycleNodes': {
    id: 'canvas.cycleNodes',
    owner: 'canvas',
    section: 'canvas',
    descriptionKey: 'shortcuts.canvas.cycleNodes',
    // Ctrl+Tab on every platform: Cmd+Tab is the macOS app switcher and
    // never arrives, so the previously documented combo was dead there.
    bindings: [{ key: 'Tab', ctrl: true }, { key: 'Tab', ctrl: true, shift: true }],
    // Works from a text field, terminal, or embedded page: this chord
    // has no text-editing meaning, and blocking it made every focused
    // input a keyboard black hole.
    editable: 'allow',
  },
  'canvas.focusMode': {
    id: 'canvas.focusMode',
    owner: 'canvas',
    section: 'canvas',
    descriptionKey: 'shortcuts.canvas.focusMode',
    bindings: [{ key: 'f' }],
    requiresSelection: true,
  },

  // ---- View / zoom -------------------------------------------------------
  'canvas.zoomIn': {
    id: 'canvas.zoomIn',
    owner: 'canvas',
    section: 'view',
    descriptionKey: 'shortcuts.view.zoomIn',
    bindings: [
      { key: '=', mod: true },
      { key: '+', mod: true, shift: true, hidden: true },
    ],
    // Works from a text field, terminal, or embedded page: this chord
    // has no text-editing meaning, and blocking it made every focused
    // input a keyboard black hole.
    editable: 'allow',
  },
  'canvas.zoomOut': {
    id: 'canvas.zoomOut',
    owner: 'canvas',
    section: 'view',
    descriptionKey: 'shortcuts.view.zoomOut',
    bindings: [{ key: '-', mod: true }],
    // Works from a text field, terminal, or embedded page: this chord
    // has no text-editing meaning, and blocking it made every focused
    // input a keyboard black hole.
    editable: 'allow',
  },
  'canvas.zoomReset': {
    id: 'canvas.zoomReset',
    owner: 'canvas',
    section: 'view',
    descriptionKey: 'shortcuts.view.zoomReset',
    bindings: [{ key: '0', mod: true }],
    // Works from a text field, terminal, or embedded page: this chord
    // has no text-editing meaning, and blocking it made every focused
    // input a keyboard black hole.
    editable: 'allow',
  },
  'canvas.fitAll': {
    id: 'canvas.fitAll',
    owner: 'canvas',
    section: 'view',
    descriptionKey: 'shortcuts.view.fitAll',
    bindings: [{ key: '1', shift: true }],
  },
  'canvas.fitSelection': {
    id: 'canvas.fitSelection',
    owner: 'canvas',
    section: 'view',
    descriptionKey: 'shortcuts.view.fitSelection',
    bindings: [{ key: '2', shift: true }],
    requiresSelection: true,
  },
  'canvas.toolSelect': {
    id: 'canvas.toolSelect',
    owner: 'canvas',
    section: 'view',
    descriptionKey: 'shortcuts.view.toolSelect',
    bindings: [{ key: 'v' }],
  },
  'canvas.toolHand': {
    id: 'canvas.toolHand',
    owner: 'canvas',
    section: 'view',
    descriptionKey: 'shortcuts.view.toolHand',
    bindings: [{ key: 'h' }],
  },
  'canvas.toolConnect': {
    id: 'canvas.toolConnect',
    owner: 'canvas',
    section: 'view',
    descriptionKey: 'shortcuts.view.toolConnect',
    bindings: [{ key: 'c' }],
  },
  'canvas.toolShape': {
    id: 'canvas.toolShape',
    owner: 'canvas',
    section: 'view',
    descriptionKey: 'shortcuts.view.toolShape',
    bindings: [{ key: 'r' }],
  },

  // ---- Selection ---------------------------------------------------------
  'canvas.nudge': {
    id: 'canvas.nudge',
    owner: 'canvas',
    section: 'selection',
    descriptionKey: 'shortcuts.selection.nudgeOne',
    bindings: [
      { key: 'ArrowUp' },
      { key: 'ArrowDown', hidden: true },
      { key: 'ArrowLeft', hidden: true },
      { key: 'ArrowRight', hidden: true },
    ],
    requiresSelection: true,
  },
  'canvas.nudgeCoarse': {
    id: 'canvas.nudgeCoarse',
    owner: 'canvas',
    section: 'selection',
    descriptionKey: 'shortcuts.selection.nudgeTen',
    bindings: [
      { key: 'ArrowUp', shift: true },
      { key: 'ArrowDown', shift: true, hidden: true },
      { key: 'ArrowLeft', shift: true, hidden: true },
      { key: 'ArrowRight', shift: true, hidden: true },
    ],
    requiresSelection: true,
  },
  'canvas.renameSelection': {
    id: 'canvas.renameSelection',
    owner: 'canvas',
    section: 'selection',
    descriptionKey: 'shortcuts.selection.rename',
    bindings: [{ key: 'F2' }, { key: 'Enter' }],
    requiresSelection: true,
  },

  // ---- Edit --------------------------------------------------------------
  'canvas.selectAll': {
    id: 'canvas.selectAll',
    owner: 'canvas',
    section: 'edit',
    descriptionKey: 'shortcuts.edit.selectAll',
    bindings: [{ key: 'a', mod: true }],
  },
  'canvas.duplicate': {
    id: 'canvas.duplicate',
    owner: 'canvas',
    section: 'edit',
    descriptionKey: 'shortcuts.edit.duplicate',
    bindings: [{ key: 'd', mod: true }],
    requiresSelection: true,
  },
  'canvas.copy': {
    id: 'canvas.copy',
    owner: 'canvas',
    section: 'edit',
    descriptionKey: 'shortcuts.edit.copy',
    bindings: [{ key: 'c', mod: true }],
    requiresSelection: true,
  },
  'canvas.paste': {
    id: 'canvas.paste',
    owner: 'document',
    section: 'edit',
    descriptionKey: 'shortcuts.edit.paste',
    bindings: [{ key: 'v', mod: true }],
  },
  'canvas.group': {
    id: 'canvas.group',
    owner: 'canvas',
    section: 'edit',
    descriptionKey: 'shortcuts.edit.group',
    bindings: [{ key: 'g', mod: true }],
    requiresSelection: true,
  },
  'canvas.ungroup': {
    id: 'canvas.ungroup',
    owner: 'canvas',
    section: 'edit',
    descriptionKey: 'shortcuts.edit.ungroup',
    bindings: [{ key: 'g', mod: true, shift: true }],
    requiresSelection: true,
  },
  'canvas.delete': {
    id: 'canvas.delete',
    owner: 'canvas',
    section: 'edit',
    descriptionKey: 'shortcuts.edit.delete',
    bindings: [{ key: 'Delete' }, { key: 'Backspace' }],
    requiresSelection: true,
  },
  'canvas.undo': {
    id: 'canvas.undo',
    owner: 'canvas',
    section: 'edit',
    descriptionKey: 'shortcuts.edit.undo',
    bindings: [{ key: 'z', mod: true }],
  },
  'canvas.redo': {
    id: 'canvas.redo',
    owner: 'canvas',
    section: 'edit',
    descriptionKey: 'shortcuts.edit.redo',
    bindings: [{ key: 'z', mod: true, shift: true }],
  },
  'canvas.redoAlt': {
    id: 'canvas.redoAlt',
    owner: 'canvas',
    section: 'edit',
    descriptionKey: 'shortcuts.edit.redoAlt',
    bindings: [{ key: 'y', mod: true }],
  },

  // ---- Panels ------------------------------------------------------------
  'canvas.toggleChatPanel': {
    id: 'canvas.toggleChatPanel',
    owner: 'canvas',
    section: 'panels',
    descriptionKey: 'shortcuts.panels.sideChat',
    bindings: [{ key: 'a', mod: true, shift: true }],
    // Works from a text field, terminal, or embedded page: this chord
    // has no text-editing meaning, and blocking it made every focused
    // input a keyboard black hole.
    editable: 'allow',
  },
  'canvas.toggleReferenceDrawer': {
    id: 'canvas.toggleReferenceDrawer',
    owner: 'canvas',
    section: 'panels',
    descriptionKey: 'shortcuts.panels.reference',
    bindings: [{ key: 'e', mod: true, shift: true }],
    // Works from a text field, terminal, or embedded page: this chord
    // has no text-editing meaning, and blocking it made every focused
    // input a keyboard black hole.
    editable: 'allow',
  },
  'canvas.escape': {
    id: 'canvas.escape',
    owner: 'canvas',
    section: 'panels',
    descriptionKey: 'shortcuts.panels.escape',
    bindings: [{ key: 'Escape' }],
    editable: 'allow',
  },
  'app.toggleChatPage': {
    id: 'app.toggleChatPage',
    owner: 'app',
    section: 'panels',
    descriptionKey: 'shortcuts.panels.chatPage',
    bindings: [{ key: 'l', mod: true, shift: true }],
    // Works from a text field, terminal, or embedded page: this chord
    // has no text-editing meaning, and blocking it made every focused
    // input a keyboard black hole.
    editable: 'allow',
  },
  'app.toggleSidebar': {
    id: 'app.toggleSidebar',
    owner: 'app',
    section: 'panels',
    descriptionKey: 'shortcuts.panels.sidebar',
    bindings: [{ key: '\\', mod: true }],
    // Works from a text field, terminal, or embedded page: this chord
    // has no text-editing meaning, and blocking it made every focused
    // input a keyboard black hole.
    editable: 'allow',
  },
  'app.switchWorkspace': {
    id: 'app.switchWorkspace',
    owner: 'app',
    section: 'panels',
    descriptionKey: 'shortcuts.panels.switchWorkspace',
    bindings: [
      { key: '1', mod: true },
      { key: '2', mod: true, hidden: true },
      { key: '3', mod: true, hidden: true },
      { key: '4', mod: true, hidden: true },
      { key: '5', mod: true, hidden: true },
      { key: '6', mod: true, hidden: true },
      { key: '7', mod: true, hidden: true },
      { key: '8', mod: true, hidden: true },
      { key: '9', mod: true, hidden: true },
    ],
    // Works from a text field, terminal, or embedded page: this chord
    // has no text-editing meaning, and blocking it made every focused
    // input a keyboard black hole.
    editable: 'allow',
  },
  'app.escapeChatPage': {
    id: 'app.escapeChatPage',
    owner: 'app',
    section: 'panels',
    // Documented by `canvas.escape`'s row — this entry exists so the App
    // layer's Escape handler is declared in the registry like every other
    // binding, not so it renders a second row.
    descriptionKey: 'shortcuts.panels.escape',
    bindings: [{ key: 'Escape', hidden: true }],
  },
  'app.shortcutsHelp': {
    id: 'app.shortcutsHelp',
    owner: 'app',
    section: 'panels',
    descriptionKey: 'shortcuts.panels.shortcuts',
    bindings: [{ key: '?', shift: true, display: '?' }, { key: '/', shift: true, hidden: true }],
  },

  // ---- Mouse gestures (documentation only) -------------------------------
  'gesture.createMenu': {
    id: 'gesture.createMenu',
    owner: 'gesture',
    section: 'canvas',
    descriptionKey: 'shortcuts.canvas.createMenu',
    bindings: [{ key: '', display: 'Right-click / Double-click' }],
  },
  'gesture.pan': {
    id: 'gesture.pan',
    owner: 'gesture',
    section: 'canvas',
    descriptionKey: 'shortcuts.canvas.pan',
    bindings: [{ key: '', display: 'Scroll' }],
  },
  'gesture.spacePan': {
    id: 'gesture.spacePan',
    owner: 'gesture',
    section: 'canvas',
    descriptionKey: 'shortcuts.canvas.spacePan',
    bindings: [{ key: '', display: 'Space + Drag' }],
  },
  'gesture.zoom': {
    id: 'gesture.zoom',
    owner: 'gesture',
    section: 'canvas',
    descriptionKey: 'shortcuts.canvas.zoom',
    bindings: [{ key: '', display: 'Ctrl/Cmd + Scroll' }],
  },
  'gesture.marquee': {
    id: 'gesture.marquee',
    owner: 'gesture',
    section: 'canvas',
    descriptionKey: 'shortcuts.canvas.marquee',
    bindings: [{ key: '', display: 'Drag on blank canvas' }],
  },
  'gesture.selectOne': {
    id: 'gesture.selectOne',
    owner: 'gesture',
    section: 'selection',
    descriptionKey: 'shortcuts.selection.selectOne',
    bindings: [{ key: '', display: 'Click' }],
  },
  'gesture.toggleSelection': {
    id: 'gesture.toggleSelection',
    owner: 'gesture',
    section: 'selection',
    descriptionKey: 'shortcuts.selection.toggle',
    bindings: [{ key: '', display: 'Shift / Ctrl/Cmd + click' }],
  },
  'gesture.extendSelection': {
    id: 'gesture.extendSelection',
    owner: 'gesture',
    section: 'selection',
    descriptionKey: 'shortcuts.selection.extend',
    bindings: [{ key: '', display: 'Shift + drag on blank canvas' }],
  },
  'gesture.disableSnap': {
    id: 'gesture.disableSnap',
    owner: 'gesture',
    section: 'selection',
    descriptionKey: 'shortcuts.selection.disableSnap',
    bindings: [{ key: '', display: 'Ctrl/Cmd while dragging' }],
  },
} satisfies Record<string, ShortcutDefinition>;


export type ShortcutId = keyof typeof SHORTCUTS;

/**
 * Ids owned by one layer. The owning hook types its handler table with this,
 * which is what makes "documented but not implemented" a compile error.
 */
export type ShortcutIdFor<O extends ShortcutOwner> = {
  [K in ShortcutId]: (typeof SHORTCUTS)[K]['owner'] extends O ? K : never;
}[ShortcutId];

export type CanvasShortcutId = ShortcutIdFor<'canvas'>;
export type AppShortcutId = ShortcutIdFor<'app'>;
