import { useSyncExternalStore } from 'react';

const STORAGE_KEY = 'pulse-canvas:minimap-open';
const listeners = new Set<() => void>();

const readStored = (): boolean => {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
};

let open: boolean | null = null;

const isMinimapOpen = (): boolean => {
  if (open === null) open = readStored();
  return open;
};

/**
 * Show or hide the canvas minimap. The zoom chip and the keyboard shortcut
 * share this one preference, so they never disagree. The choice survives a
 * reload when storage is available.
 */
export const toggleMinimap = (): void => {
  open = !isMinimapOpen();
  try {
    window.localStorage.setItem(STORAGE_KEY, open ? '1' : '0');
  } catch {
    // The choice still applies for this session.
  }
  listeners.forEach((listener) => listener());
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const useMinimapOpen = (): boolean => useSyncExternalStore(subscribe, isMinimapOpen);
