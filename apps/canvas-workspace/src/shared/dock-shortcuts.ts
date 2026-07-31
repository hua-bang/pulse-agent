/**
 * Keyboard command policy for the dock's web tabs — shared because both
 * processes must agree on it.
 *
 * A `<webview>` guest is a separate WebContents, so a key pressed while an
 * embedded page has focus never reaches the host window's `keydown`. Without
 * a main-process relay every browsing shortcut would work only when the dock
 * chrome happened to be focused. `main/app/webview-shortcuts.ts` matches these
 * same chords in `before-input-event` and forwards the resolved command to the
 * renderer, which handles it identically to a locally observed key.
 */
import type { WebviewRegistrationIdentity } from './webview-registration';

export type DockBrowserCommand =
  | 'new-tab'
  | 'close-tab'
  | 'reopen-tab'
  | 'focus-address'
  | 'reload'
  | 'find'
  | 'next-tab'
  | 'previous-tab';

export interface DockShortcutRequest {
  command: DockBrowserCommand;
  source: WebviewRegistrationIdentity;
}

/**
 * Commands the canvas also binds. The host-window listener claims these only
 * when focus is already inside the dock, so the canvas keeps its own meaning
 * everywhere else. The guest relay is exempt: a key pressed inside a page is
 * unambiguously meant for that page.
 */
export const DOCK_FOCUS_SCOPED_COMMANDS: ReadonlySet<DockBrowserCommand> = new Set(['find']);

interface Binding {
  command: DockBrowserCommand;
  key: string;
  code?: string;
  shift?: boolean;
}

// ⌘ on macOS, Ctrl elsewhere — both are accepted everywhere; the app ships on
// all three platforms and a wrong-modifier miss reads as a dead shortcut.
const BINDINGS: readonly Binding[] = [
  { command: 'new-tab', key: 't' },
  { command: 'reopen-tab', key: 't', shift: true },
  { command: 'close-tab', key: 'w' },
  { command: 'focus-address', key: 'l' },
  { command: 'reload', key: 'r' },
  { command: 'find', key: 'f' },
  { command: 'next-tab', key: ']', code: 'BracketRight', shift: true },
  { command: 'previous-tab', key: '[', code: 'BracketLeft', shift: true },
];

export interface DockShortcutInput {
  key: string;
  code?: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

/**
 * Resolve a key event to a browsing command, or null to leave it alone.
 * Alt-modified chords belong to the OS / text editing, and anything without
 * the platform modifier must keep reaching the page unchanged.
 */
export function resolveDockBrowserCommand(event: DockShortcutInput): DockBrowserCommand | null {
  if (event.altKey) return null;
  if (!event.metaKey && !event.ctrlKey) return null;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  const normalizedKey = event.shiftKey && key === '}'
    ? ']'
    : event.shiftKey && key === '{' ? '[' : key;
  const shift = Boolean(event.shiftKey);
  for (const binding of BINDINGS) {
    const keyMatches = binding.key === normalizedKey
      || (binding.code !== undefined && binding.code === event.code);
    if (keyMatches && Boolean(binding.shift) === shift) return binding.command;
  }
  return null;
}
