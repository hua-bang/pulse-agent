import { describe, expect, it } from 'vitest';
import { getDockTabVisualState } from './dock-tab-visual-state';

describe('getDockTabVisualState', () => {
  it('marks any two comparison tabs as visible while preserving their stable sides and focus', () => {
    const pair: [string, string] = ['artifact-1', 'link-1'];
    expect(getDockTabVisualState('artifact-1', 'link-1', pair)).toEqual({
      focused: false,
      selected: true,
      splitActive: true,
      splitVisible: true,
      splitPart: 'left',
    });
    expect(getDockTabVisualState('link-1', 'link-1', pair)).toEqual({
      focused: true,
      selected: true,
      splitActive: true,
      splitVisible: true,
      splitPart: 'right',
    });
  });

  it('uses the regular single-tab state outside split view', () => {
    expect(getDockTabVisualState('link-1', 'link-1', undefined)).toEqual({
      focused: true,
      selected: true,
      splitActive: false,
      splitVisible: false,
      splitPart: undefined,
    });
  });

  it('does not mark unrelated tabs as visible in split view', () => {
    expect(getDockTabVisualState('link-2', 'artifact-1', ['artifact-1', 'link-1'])).toEqual({
      focused: false,
      selected: false,
      splitActive: true,
      splitVisible: false,
      splitPart: undefined,
    });
  });
});
