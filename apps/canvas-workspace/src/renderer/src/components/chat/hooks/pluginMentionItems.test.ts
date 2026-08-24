// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMentionChipElement } from '../utils/mentions';
import {
  collectPluginRefsFromEditable,
  loadInstalledPluginMentionItems,
  resetPluginMentionItemsForTests,
  withCollectedPlugins,
} from './pluginMentionItems';

afterEach(() => {
  resetPluginMentionItemsForTests();
  vi.restoreAllMocks();
});

describe('plugin mention items', () => {
  it('offers only healthy installed market listings', async () => {
    Object.defineProperty(window, 'canvasWorkspace', {
      configurable: true,
      value: {
        pluginMarket: {
          list: vi.fn(async () => ({
            ok: true,
            snapshot: {
              updatedAt: 1,
              listings: [
                { id: 'notion', name: 'Notion', iconKey: 'notion', description: 'Notion workspace', installState: 'installed' },
                { id: 'exa', name: 'Exa', description: 'Search', installState: 'available' },
                { id: 'broken', name: 'Broken', description: 'Broken', installState: 'installed', error: 'Unreadable' },
              ],
            },
          })),
        },
      },
    });

    await expect(loadInstalledPluginMentionItems()).resolves.toEqual([
      { type: 'plugin', pluginId: 'notion', pluginIconKey: 'notion', label: 'Notion', description: 'Notion workspace' },
    ]);
  });

  it('collects structured plugin refs and deduplicates existing context', () => {
    const editable = document.createElement('div');
    editable.appendChild(createMentionChipElement({ type: 'plugin', pluginId: 'notion', label: 'Notion' }));
    editable.appendChild(createMentionChipElement({ type: 'plugin', pluginId: 'notion', label: 'Notion' }));

    expect(collectPluginRefsFromEditable(editable)).toEqual([{ id: 'notion', name: 'Notion' }]);
    expect(withCollectedPlugins(editable, { plugins: [{ id: 'notion', name: 'Notion' }] }))
      .toEqual({ plugins: [{ id: 'notion', name: 'Notion' }] });
  });
});
