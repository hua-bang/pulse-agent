import { useEffect, type RefObject } from 'react';
import { useEscapeClose } from './useEscapeClose';

type MenuKeyboardNavOptions = {
  enabled?: boolean;
  autoFocus?: boolean;
  scope?: 'global' | 'within';
};

/**
 * Keyboard navigation for popup menus (context menus, dropdowns). Moves
 * focus into the first item on mount, lets ArrowUp/ArrowDown (and
 * Home/End) cycle through the menu's buttons, and closes on Escape.
 * Enter/Space activate the focused item via native button behavior.
 *
 * Escape is delegated to the shared `useEscapeClose` so every overlay
 * dismisses on Escape identically: capture phase, `stopPropagation` (so it
 * doesn't also fire window-level shortcuts like canvas deselect), and
 * IME-aware (the Escape that dismisses a CJK candidate window is ignored).
 */
export const useMenuKeyboardNav = (
  ref: RefObject<HTMLElement>,
  onClose?: () => void,
  config: boolean | MenuKeyboardNavOptions = true,
) => {
  const enabled = typeof config === 'boolean' ? config : config.enabled ?? true;
  const autoFocus = typeof config === 'boolean' ? true : config.autoFocus ?? true;
  const scope = typeof config === 'boolean' ? 'global' : config.scope ?? 'global';

  // Focus the active item once on mount so arrow keys work immediately.
  // kept separate from the keydown effect so identity changes in
  // `onClose` don't yank focus back to the top mid-navigation.
  useEffect(() => {
    if (!enabled || !autoFocus) return;
    // Two-step lookup, NOT a single comma-selector: querySelector on
    // 'a, b' returns the first DOM-order match of EITHER clause, so a
    // combined selector can never PRIORITIZE the marked item — every
    // enabled <button> before it wins (review finding: the marker was
    // inert since introduction, silently defeating selected-item focus
    // in ui/Select, EdgeStylePanel, and ui/SwatchRow hosts).
    const initial =
      ref.current?.querySelector<HTMLButtonElement>('[data-menu-autofocus="true"]:not(:disabled)') ??
      ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)');
    initial?.focus();
  }, [autoFocus, enabled, ref]);

  useEscapeClose(enabled, () => onClose?.());

  useEffect(() => {
    if (!enabled) return undefined;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') {
        return;
      }
      if (scope === 'within') {
        const target = e.target as Node | null;
        if (!target || !ref.current?.contains(target)) return;
      }
      const items = Array.from(
        ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [],
      );
      if (items.length === 0) return;
      e.preventDefault();
      e.stopPropagation();
      const current = items.indexOf(document.activeElement as HTMLButtonElement);
      let next: number;
      if (e.key === 'ArrowDown') next = current < 0 ? 0 : (current + 1) % items.length;
      else if (e.key === 'ArrowUp') next = current <= 0 ? items.length - 1 : current - 1;
      else if (e.key === 'Home') next = 0;
      else next = items.length - 1;
      items[next].focus();
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [enabled, ref, onClose, scope]);
};
