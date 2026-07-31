import { describe, expect, it } from 'vitest';
import { getDockTabSwitcherItems } from '../dock-tab-items';
import { DockStore } from '../dock-store';

describe('getDockTabSwitcherItems', () => {
  it('uses the same visible tab set as the strip when chat and terminals are unavailable', () => {
    const store = new DockStore();
    store.setActiveWorkspace('ws-a');
    store.openTerminal();
    store.openLink('https://example.com/');

    const items = getDockTabSwitcherItems(store.getSnapshot(), {
      chatTabEnabled: false,
      chatTitle: 'Pulse AI',
      terminalTitle: 'Terminal',
    });

    expect(items.map((item) => item.kind)).toEqual(['link']);
  });
});
