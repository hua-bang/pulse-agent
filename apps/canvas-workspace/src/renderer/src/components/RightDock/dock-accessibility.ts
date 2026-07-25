import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { clampIndexMove, indexNavEnd, indexNavHome } from '../ui';
import { dockTabElementId } from './dock-tab-ids';

const KEYBOARD_RESIZE_STEP = 24;

export const getRovingDockTabId = (
  tabIds: readonly string[],
  activeTabId: string | null,
): string | undefined => (
  activeTabId && tabIds.includes(activeTabId) ? activeTabId : tabIds[0]
);

export const handleDockTabListKeyDown = (
  event: ReactKeyboardEvent<HTMLDivElement>,
  tabIds: readonly string[],
  activate: (tabId: string) => void,
): void => {
  if (
    event.key !== 'ArrowLeft'
    && event.key !== 'ArrowRight'
    && event.key !== 'Home'
    && event.key !== 'End'
  ) {
    return;
  }
  const target = event.target instanceof Element
    ? event.target.closest<HTMLButtonElement>('[role="tab"][data-dock-tab-id]')
    : null;
  const currentTabId = target?.dataset.dockTabId;
  const currentIndex = currentTabId ? tabIds.indexOf(currentTabId) : -1;
  if (currentIndex < 0 || tabIds.length === 0) return;

  event.preventDefault();
  event.stopPropagation();
  const nextIndex = event.key === 'Home'
    ? indexNavHome()
    : event.key === 'End'
      ? indexNavEnd(tabIds.length)
      : clampIndexMove(
        currentIndex,
        event.key === 'ArrowRight' ? 1 : -1,
        tabIds.length,
        { wrap: true },
      );
  const nextTabId = tabIds[nextIndex];
  activate(nextTabId);
  document.getElementById(dockTabElementId(nextTabId))?.focus();
};

interface ResizeKeyOptions {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}

export const handleDockResizeKeyDown = (
  event: ReactKeyboardEvent<HTMLDivElement>,
  { value, min, max, onChange }: ResizeKeyOptions,
): void => {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  event.preventDefault();
  event.stopPropagation();
  const direction = event.key === 'ArrowLeft' ? 1 : -1;
  onChange(Math.min(max, Math.max(min, value + direction * KEYBOARD_RESIZE_STEP)));
};
