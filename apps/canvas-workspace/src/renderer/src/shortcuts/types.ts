/**
 * Shape of a keyboard shortcut declaration. Split from `registry.ts` so the
 * declaration table (`definitions.ts`) and the matching/formatting helpers
 * can each stay a readable size.
 */
/** Which layer owns the handler for a shortcut. */
export type ShortcutOwner =
  /** `useCanvasKeyboard` — only fires on the visible, unlocked canvas. */
  | 'canvas'
  /** `useAppShortcuts` in App.tsx — app chrome, works on every route. */
  | 'app'
  /**
   * `shortcuts/terminalShortcuts.ts`, dispatched from an xterm
   * `attachCustomKeyEventHandler` — fires ONLY while a terminal or coding-
   * agent surface owns focus, which is what lets a terminal-owned chord
   * share a key with a global `canvas`/`app` one. Claiming is not automatic:
   * the dispatcher calls `preventDefault`, because returning false to xterm
   * stops xterm alone and the DOM event keeps bubbling to the window
   * listeners (see that module's header for the incident).
   */
  | 'terminal'
  /**
   * Handled by a native document-level event rather than the keydown
   * dispatcher. Paste is the only one: letting the browser's `paste` event
   * arbitrate is what allows the system clipboard to beat a stale canvas
   * clipboard, which a keydown `preventDefault` made impossible.
   */
  | 'document';

export type ShortcutSectionId = 'canvas' | 'view' | 'selection' | 'edit' | 'panels';

/**
 * What happens when focus sits in an `<input>` / `<textarea>` /
 * contentEditable. `block` (default) leaves the keystroke to the editor;
 * `allow` runs the handler anyway — used by Escape and by find, which apply
 * their own narrower guards.
 */
export type EditablePolicy = 'block' | 'allow';

export interface KeyBinding {
  /** Compared case-insensitively against `KeyboardEvent.key`. */
  key: string;
  /**
   * Cmd on macOS, Ctrl elsewhere. Matches meta OR ctrl so the Windows
   * muscle-memory combos keep working on a Mac keyboard.
   */
  mod?: boolean;
  /**
   * Literal Control on every platform. Used where macOS reserves the Cmd
   * variant for itself: Cmd+H is "hide application" and Cmd+Tab is the app
   * switcher, so neither ever reaches the renderer there.
   */
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
  /** Replaces the generated label (e.g. "Space + drag"). */
  display?: string;
  /** Keep the binding active but hide it from the help overlay. */
  hidden?: boolean;
}

export interface ShortcutDefinition {
  owner: ShortcutOwner;
  bindings: KeyBinding[];
  editable?: EditablePolicy;
  /**
   * Set for shortcuts whose handler is a no-op most of the time (tool
   * hotkeys, nudging). Purely informational — it documents that a miss is
   * expected rather than a bug.
   */
  requiresSelection?: boolean;
}

export interface KeyEventLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}
