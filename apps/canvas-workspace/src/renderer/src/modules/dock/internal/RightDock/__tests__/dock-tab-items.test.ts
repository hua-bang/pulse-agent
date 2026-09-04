import { describe, expect, it } from 'vitest';
import { getDockTabSwitcherItems } from '../dock-tab-items';
import { DockStore } from '../dock-store';

describe('getDockTabSwitcherItems', () => {
  it('keeps terminal tabs in the switcher even when the chat tab is unavailable', () => {
    const store = new DockStore();
    store.setActiveWorkspace('ws-a');
    store.openTerminal();
    store.openLink('https://example.com/');

    const items = getDockTabSwitcherItems(store.getSnapshot(), {
      chatTabEnabled: false,
      chatTitle: 'Pulse AI',
      terminalTitle: 'Terminal',
    });

    expect(items.map((item) => item.kind)).toEqual(['terminal', 'link']);
  });

  it('preserves the exact icon metadata used by the tab strip', () => {
    const store = new DockStore();
    store.setActiveWorkspace('ws-a');
    store.openTerminal();
    const terminalId = store.getSnapshot().terminalTabs[0]!.id;
    store.setTerminalAgentType(terminalId, 'codex');
    store.openArtifact('ws-a', 'artifact-a');
    store.openLink('https://example.com/');
    const linkId = store.getSnapshot().tabs.find((tab) => tab.kind === 'link')!.id;
    store.setFavicon(linkId, 'https://example.com/favicon.ico');

    const items = getDockTabSwitcherItems(store.getSnapshot(), {
      chatTabEnabled: true,
      chatTitle: 'Pulse AI',
      terminalTitle: 'Terminal',
    });

    expect(items.find((item) => item.id === terminalId)).toMatchObject({
      kind: 'terminal',
      agentType: 'codex',
    });
    expect(items.find((item) => item.id === linkId)).toMatchObject({
      kind: 'link',
      faviconUrl: 'https://example.com/favicon.ico',
    });
    expect(items.some((item) => item.kind === 'artifact')).toBe(true);
  });
});
