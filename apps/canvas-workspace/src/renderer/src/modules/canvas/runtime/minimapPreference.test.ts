// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const STORAGE_KEY = 'pulse-canvas:minimap-open';

const load = async () => {
  vi.resetModules();
  return import('./minimapPreference');
};

describe('minimapPreference', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('persists each toggle', async () => {
    const { toggleMinimap } = await load();

    toggleMinimap();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('1');

    toggleMinimap();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('0');
  });

  it('starts from the stored value', async () => {
    window.localStorage.setItem(STORAGE_KEY, '1');
    const { toggleMinimap } = await load();

    toggleMinimap();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('0');
  });
});
