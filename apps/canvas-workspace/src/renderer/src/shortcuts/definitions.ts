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
    owner: 'canvas',
    bindings: [{ key: 'k', mod: true }],
    // Works from a text field, terminal, or embedded page: this chord
    // has no text-editing meaning, and blocking it made every focused
    // input a keyboard black hole.
    editable: 'allow',
  },
  'canvas.commandPaletteAlt': {
    owner: 'canvas',
    // Ctrl, not Cmd: macOS swallows Cmd+H as "hide application", so the
    // documented Cmd+H never reached the renderer there.
    bindings: [{ key: 'h', ctrl: true }],
    // Works from a text field, terminal, or embedded page: this chord
    // has no text-editing meaning, and blocking it made every focused
    // input a keyboard black hole.
    editable: 'allow',
  },
  'canvas.find': {
    owner: 'canvas',
    bindings: [{ key: 'f', mod: true }],
    // Note cards own their own find flow; the handler re-checks that.
    editable: 'allow',
  },
  'canvas.findNext': {
    owner: 'canvas',
    bindings: [{ key: 'F3' }, { key: 'F3', shift: true }],
    editable: 'allow',
  },
  'canvas.cycleNodes': {
    owner: 'canvas',
    // Ctrl+Tab on every platform: Cmd+Tab is the macOS app switcher and
    // never arrives, so the previously documented combo was dead there.
    bindings: [{ key: 'Tab', ctrl: true }, { key: 'Tab', ctrl: true, shift: true }],
    // Works from a text field, terminal, or embedded page: this chord
    // has no text-editing meaning, and blocking it made every focused
    // input a keyboard black hole.
    editable: 'allow',
  },
  'canvas.focusMode': {
    owner: 'canvas',
    bindings: [{ key: 'f' }],
    requiresSelection: true,
  },

  // ---- View / zoom -------------------------------------------------------
  'canvas.zoomIn': {
    owner: 'canvas',
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
    owner: 'canvas',
    bindings: [{ key: '-', mod: true }],
    // Works from a text field, terminal, or embedded page: this chord
    // has no text-editing meaning, and blocking it made every focused
    // input a keyboard black hole.
    editable: 'allow',
  },
  'canvas.zoomReset': {
    owner: 'canvas',
    bindings: [{ key: '0', mod: true }],
    // Works from a text field, terminal, or embedded page: this chord
    // has no text-editing meaning, and blocking it made every focused
    // input a keyboard black hole.
    editable: 'allow',
  },
  'canvas.fitAll': {
    owner: 'canvas',
    bindings: [{ key: '1', shift: true }],
  },
  'canvas.fitSelection': {
    owner: 'canvas',
    bindings: [{ key: '2', shift: true }],
    requiresSelection: true,
  },
  'canvas.toolSelect': {
    owner: 'canvas',
    bindings: [{ key: 'v' }],
  },
  'canvas.toolHand': {
    owner: 'canvas',
    bindings: [{ key: 'h' }],
  },
  'canvas.toolConnect': {
    owner: 'canvas',
    bindings: [{ key: 'c' }],
  },
  // ---- Selection ---------------------------------------------------------
  'canvas.nudge': {
    owner: 'canvas',
    bindings: [
      { key: 'ArrowUp' },
      { key: 'ArrowDown', hidden: true },
      { key: 'ArrowLeft', hidden: true },
      { key: 'ArrowRight', hidden: true },
    ],
    requiresSelection: true,
  },
  'canvas.nudgeCoarse': {
    owner: 'canvas',
    bindings: [
      { key: 'ArrowUp', shift: true },
      { key: 'ArrowDown', shift: true, hidden: true },
      { key: 'ArrowLeft', shift: true, hidden: true },
      { key: 'ArrowRight', shift: true, hidden: true },
    ],
    requiresSelection: true,
  },
  'canvas.renameSelection': {
    owner: 'canvas',
    bindings: [{ key: 'F2' }, { key: 'Enter' }],
    requiresSelection: true,
  },

  // ---- Edit --------------------------------------------------------------
  'canvas.selectAll': {
    owner: 'canvas',
    bindings: [{ key: 'a', mod: true }],
  },
  'canvas.duplicate': {
    owner: 'canvas',
    bindings: [{ key: 'd', mod: true }],
    requiresSelection: true,
  },
  'canvas.copy': {
    owner: 'canvas',
    bindings: [{ key: 'c', mod: true }],
    requiresSelection: true,
  },
  'canvas.paste': {
    owner: 'document',
    bindings: [{ key: 'v', mod: true }],
  },
  'canvas.group': {
    owner: 'canvas',
    bindings: [{ key: 'g', mod: true }],
    requiresSelection: true,
  },
  'canvas.ungroup': {
    owner: 'canvas',
    bindings: [{ key: 'g', mod: true, shift: true }],
    requiresSelection: true,
  },
  'canvas.delete': {
    owner: 'canvas',
    bindings: [{ key: 'Delete' }, { key: 'Backspace' }],
    requiresSelection: true,
  },
  'canvas.undo': {
    owner: 'canvas',
    bindings: [{ key: 'z', mod: true }],
  },
  'canvas.redo': {
    owner: 'canvas',
    bindings: [{ key: 'z', mod: true, shift: true }],
  },
  'canvas.redoAlt': {
    owner: 'canvas',
    bindings: [{ key: 'y', mod: true }],
  },

  // ---- Panels ------------------------------------------------------------
  'canvas.toggleChatPanel': {
    owner: 'canvas',
    bindings: [{ key: 'a', mod: true, shift: true }],
    // Works from a text field, terminal, or embedded page: this chord
    // has no text-editing meaning, and blocking it made every focused
    // input a keyboard black hole.
    editable: 'allow',
  },
  'canvas.toggleReferenceDrawer': {
    owner: 'canvas',
    bindings: [{ key: 'e', mod: true, shift: true }],
    // Works from a text field, terminal, or embedded page: this chord
    // has no text-editing meaning, and blocking it made every focused
    // input a keyboard black hole.
    editable: 'allow',
  },
  'canvas.escape': {
    owner: 'canvas',
    bindings: [{ key: 'Escape' }],
    editable: 'allow',
  },
  'app.toggleChatPage': {
    owner: 'app',
    bindings: [{ key: 'l', mod: true, shift: true }],
    // Works from a text field, terminal, or embedded page: this chord
    // has no text-editing meaning, and blocking it made every focused
    // input a keyboard black hole.
    editable: 'allow',
  },
  'app.toggleSidebar': {
    owner: 'app',
    bindings: [{ key: '\\', mod: true }],
    // Works from a text field, terminal, or embedded page: this chord
    // has no text-editing meaning, and blocking it made every focused
    // input a keyboard black hole.
    editable: 'allow',
  },
  'app.switchWorkspace': {
    owner: 'app',
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
    owner: 'app',
    // Documented by `canvas.escape`'s row — this entry exists so the App
    // layer's Escape handler is declared in the registry like every other
    // binding, not so it renders a second row.
    bindings: [{ key: 'Escape', hidden: true }],
  },
  // ---- Terminal-scoped ---------------------------------------------------
  // Only live while a terminal / coding-agent surface owns focus, so they may
  // deliberately share a chord with a global canvas/app binding — the focused
  // surface claims it first. See `terminalShortcuts.ts`.
  'terminal.mentionPicker': {
    owner: 'terminal',
    // Shares Cmd/Ctrl+2 with app.switchWorkspace ON PURPOSE: a focused
    // terminal wins the key, everywhere else it still switches workspace.
    // `mod` matches meta OR ctrl on every platform, which is what the four
    // hand-written `(ctrlKey || metaKey)` conditions this replaced did.
    bindings: [{ key: '2', mod: true }],
    // xterm's helper element is a <textarea>, so the whole surface reads as
    // "editable" — without this the terminal's own shortcut never fires.
    editable: 'allow',
  },

  'app.shortcutsHelp': {
    owner: 'app',
    bindings: [{ key: '?', shift: true, display: '?' }, { key: '/', shift: true, hidden: true }],
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
export type TerminalShortcutId = ShortcutIdFor<'terminal'>;
