import { useEffect, type RefObject } from 'react';
import { useEscapeClose } from './useEscapeClose';

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
) => {
  // Focus the first item once on mount so arrow keys work immediately;
  // kept separate from the keydown effect so identity changes in
  // `onClose` don't yank focus back to the top mid-navigation.
  useEffect(() => {
    const first = ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)');
    first?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEscapeClose(true, () => onClose?.());

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') {
        return;
      }
      const items = Array.from(
        ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [],
      );
      if (items.length === 0) return;
      e.preventDefault();
      const current = items.indexOf(document.activeElement as HTMLButtonElement);
      let next: number;
      if (e.key === 'ArrowDown') next = current < 0 ? 0 : (current + 1) % items.length;
      else if (e.key === 'ArrowUp') next = current <= 0 ? items.length - 1 : current - 1;
      else if (e.key === 'Home') next = 0;
      else next = items.length - 1;
      items[next].focus();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [ref, onClose]);
};
