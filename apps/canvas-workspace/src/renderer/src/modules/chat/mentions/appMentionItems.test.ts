// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { globalMcpAppsStore } from '../../mcp-apps/global-apps';
import { collectAppMentionContexts, loadAppMentionItems } from './appMentionItems';
import { createMentionChipElement, renderMdWithMentions, serializeEditable } from './mentions';
import { sortAndCapMentionItems } from '../components/ChatMentionPopup/constants';

const drawings = { kind: 'global' as const, serverName: 'drawing/server', toolName: 'open:library', resourceUri: 'ui://library', title: '图纸 | [库]' };
const boards = { ...drawings, serverName: 'boards', title: 'Boards' };
const marker = (app = drawings) => {
  const editable = document.createElement('div');
  editable.append(createMentionChipElement({ type: 'app', label: app.title, app }));
  return serializeEditable(editable);
};

afterEach(() => {
  for (const app of globalMcpAppsStore.getSnapshot().running) globalMcpAppsStore.close(app.key);
  globalMcpAppsStore.setActive(null);
  vi.restoreAllMocks();
});

describe('@App references', () => {
  it('lists global entrypoints in their own group even with many plugins', async () => {
    vi.spyOn(globalMcpAppsStore, 'getSnapshot').mockReturnValue({ loaded: true, listings: [drawings], running: [] });
    const apps = await loadAppMentionItems();
    const result = sortAndCapMentionItems([
      ...Array.from({ length: 40 }, (_, index) => ({ type: 'plugin' as const, label: `Plugin ${index}` })), ...apps,
    ]);
    expect(result.filter(item => item.type === 'app')).toEqual(apps);
    expect(apps[0].description).toBe('drawing/server · open:library');
  });

  it('round-trips delimiter-rich identities and renders names as inert text', () => {
    const html = renderMdWithMentions(marker());
    const element = document.createElement('div');
    element.innerHTML = html;
    expect(element.querySelector('.chat-mention-chip-label')?.textContent).toBe(drawings.title);
    expect(collectAppMentionContexts(marker())[0]).toMatchObject({ serverName: drawings.serverName, toolName: drawings.toolName });
    element.innerHTML = renderMdWithMentions(marker({ ...drawings, title: '<img src=x onerror=alert(1)>' }));
    expect(element.querySelector('img')).toBeNull();
  });

  it('deduplicates explicit references and freezes only the visible App view', () => {
    globalMcpAppsStore.open(drawings);
    globalMcpAppsStore.open(boards);
    const [drawingApp, boardApp] = globalMcpAppsStore.getSnapshot().running;
    globalMcpAppsStore.publishContext(drawingApp, 'visible-ui', { content: [{ type: 'text', text: 'Selected drawing: architecture' }] });
    globalMcpAppsStore.publishContext(boardApp, 'visible-ui', { content: [{ type: 'text', text: 'Hidden board' }] });
    globalMcpAppsStore.setActive(drawingApp.key);
    const contexts = collectAppMentionContexts(`${marker()} ${marker(boards)} ${marker()}`);
    expect(contexts).toHaveLength(2);
    expect(contexts[0].snapshots[0].text).toBe('Selected drawing: architecture');
    expect(contexts[1].snapshots).toEqual([]);
    globalMcpAppsStore.reload(drawingApp.key);
    expect(collectAppMentionContexts(marker())[0].snapshots).toEqual([]);
    expect(contexts[0].snapshots[0].text).toBe('Selected drawing: architecture');
    globalMcpAppsStore.close(drawingApp.key);
    expect(collectAppMentionContexts(marker())[0].snapshots).toEqual([]);
  });
});
