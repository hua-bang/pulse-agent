/**
 * Runtime source of truth for every keyboard shortcut in the workbench.
 *
 * Before this file the same binding was written three times — the behavior
 * in `useCanvasKeyboard`, the row in the help overlay's `SHORTCUT_SECTIONS`,
 * and the hint string in the Cmd+K palette — with nothing keeping them in
 * sync. They drifted: `Cmd+Shift+A` was advertised in both surfaces while no
 * handler existed (and, because the old matcher ignored unlisted modifiers,
 * it actually ran *select all*), and every displayed combo was a hardcoded
 * `Cmd+…`/`Ctrl/Cmd+…` string that lied on one platform or the other.
 *
 * The fix is mechanical, not documentary:
 *   - Every binding is declared once in `definitions.ts`.
 *   - `owner` names the layer that must implement it. The owning hook
 *     declares its handler table as `Record<ShortcutIdFor<'canvas'>, …>`, so
 *     documenting a shortcut without implementing it is a TYPE ERROR, and
 *     deleting a handler while leaving the help row is too.
 *   - The lazy help overlay and the palette derive their labels from
 *     `formatBinding()`, so combos are always right for the host platform.
 *
 * Match semantics are EXACT on modifiers: a definition without `shift` does
 * not fire when Shift is held. That exactness is what stops `Cmd+Shift+A`
 * from falling into `Cmd+A`.
 */
import { formatShortcut } from '../utils/keyboardShortcut';
import { SHORTCUTS, type ShortcutId } from './definitions';
import type {
  KeyBinding,
  KeyEventLike,
  ShortcutDefinition,
  ShortcutOwner,
} from './types';

export * from './types';
export {
  SHORTCUTS,
  type AppShortcutId,
  type CanvasShortcutId,
  type ShortcutId,
  type ShortcutIdFor,
  type TerminalShortcutId,
} from './definitions';

const KEY_DISPLAY: Record<string, string> = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Escape: 'Esc',
  Delete: 'Del',
  Backspace: 'Backspace',
  Enter: 'Enter',
  ' ': 'Space',
};

const displayKey = (key: string): string =>
  KEY_DISPLAY[key] ?? (key.length === 1 ? key.toUpperCase() : key);

/** Platform-correct label for one binding (⌘K on macOS, Ctrl+K elsewhere). */
export const formatBinding = (binding: KeyBinding): string =>
  binding.display
  ?? formatShortcut({
    key: displayKey(binding.key),
    mod: binding.mod,
    ctrl: binding.ctrl,
    alt: binding.alt,
    shift: binding.shift,
  });

/**
 * Label for a whole definition — the first visible binding. Used by the
 * palette, tooltips, and the help overlay so no surface hardcodes a combo.
 */
export const formatShortcutId = (id: ShortcutId): string => {
  const definition: ShortcutDefinition = SHORTCUTS[id];
  const visible = definition.bindings.filter((binding) => !binding.hidden);
  return formatBinding(visible[0] ?? definition.bindings[0]);
};

/**
 * One label per visible binding. The help overlay renders each as its own
 * chip group — joining them into a single string made it split on `+` and
 * chip `Ctrl+Tab / Ctrl+Shift+Tab` as `Ctrl | Tab / Ctrl | Shift | Tab`.
 */
export const formatAllBindings = (definition: ShortcutDefinition): string[] =>
  definition.bindings
    .filter((binding) => !binding.hidden)
    .map(formatBinding);

/**
 * Exact-modifier match. Unlisted modifiers must be UP — the old hand-written
 * conditions omitted this and let `Cmd+Shift+A` run the `Cmd+A` branch.
 */
export const matchesBinding = (event: KeyEventLike, binding: KeyBinding): boolean => {
  if (event.key.toLowerCase() !== binding.key.toLowerCase()) return false;
  if (binding.ctrl) {
    if (!event.ctrlKey || event.metaKey) return false;
  } else if (binding.mod) {
    if (!(event.metaKey || event.ctrlKey)) return false;
  } else if (event.metaKey || event.ctrlKey) {
    return false;
  }
  if (!!binding.alt !== event.altKey) return false;
  if (!!binding.shift !== event.shiftKey) return false;
  return true;
};

const ALL_DEFINITIONS = Object.entries(SHORTCUTS) as Array<[ShortcutId, ShortcutDefinition]>;

export interface ShortcutMatch {
  id: ShortcutId;
  definition: ShortcutDefinition;
  binding: KeyBinding;
}

/**
 * First definition of `owner` whose binding matches. Literal-Ctrl entries win
 * over `mod` entries because they are declared first.
 */
export const matchShortcut = (
  event: KeyEventLike,
  owner: ShortcutOwner,
): ShortcutMatch | null => {
  for (const [id, definition] of ALL_DEFINITIONS) {
    if (definition.owner !== owner) continue;
    for (const binding of definition.bindings) {
      if (binding.key && matchesBinding(event, binding)) return { id, definition, binding };
    }
  }
  return null;
};
