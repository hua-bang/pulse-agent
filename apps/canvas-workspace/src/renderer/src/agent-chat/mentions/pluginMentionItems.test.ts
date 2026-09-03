// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
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
    const createPluginChip = () => {
      const chip = document.createElement('span');
      chip.dataset.mentionKind = 'plugin';
      chip.dataset.pluginId = 'notion';
      const label = document.createElement('span');
      label.className = 'chat-mention-chip-label';
      label.textContent = 'Notion';
      chip.appendChild(label);
      return chip;
    };
    editable.appendChild(createPluginChip());
    editable.appendChild(createPluginChip());

    expect(collectPluginRefsFromEditable(editable)).toEqual([{ id: 'notion', name: 'Notion' }]);
    expect(withCollectedPlugins(editable, { plugins: [{ id: 'notion', name: 'Notion' }] }))
      .toEqual({ plugins: [{ id: 'notion', name: 'Notion' }] });
  });
});
