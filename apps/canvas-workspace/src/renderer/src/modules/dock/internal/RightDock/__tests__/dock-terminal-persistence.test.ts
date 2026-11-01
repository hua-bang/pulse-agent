import { describe, expect, it } from 'vitest';
import { DockStore, TERMINAL_TAB_ID, terminalTabId } from '../state/dock-store';
import {
  DOCK_TERMINAL_STORAGE_KEY,
  createDockTerminalPersistence,
} from '../state/dock-terminal-persistence';

const createStorage = (initial: Record<string, string> = {}) => {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
};

/** Simulate an app restart: a new store reads what the previous one saved. */
const restart = (storage: ReturnType<typeof createStorage>) => new DockStore(
  undefined,
  undefined,
  createDockTerminalPersistence(storage),
);

describe('dock terminal persistence', () => {
  it('restores terminal tabs, titles, and folders after a restart', () => {
    const storage = createStorage();
    const before = restart(storage);
    before.setActiveWorkspace('ws-a');
    before.openTerminal();
    before.newTerminal();
    before.renameTerminal(terminalTabId(2), 'server');
    before.setTerminalCwd(terminalTabId(2), '/repo/api');
    before.setTerminalAgentType(TERMINAL_TAB_ID, 'claude-code');

    const after = restart(storage);
    after.setActiveWorkspace('ws-a');
    const snapshot = after.getSnapshot();

    expect(snapshot.terminalTabs).toEqual([
      { id: TERMINAL_TAB_ID, ordinal: 1 },
      { id: terminalTabId(2), ordinal: 2, title: 'server', cwd: '/repo/api' },
    ]);
    expect(snapshot.activeTerminalTabId).toBe(terminalTabId(2));
    // New terminals keep counting, so no restored tab id is reused.
    after.newTerminal();
    expect(after.getSnapshot().terminalTabs.map((tab) => tab.id)).toEqual([
      TERMINAL_TAB_ID,
      terminalTabId(2),
      terminalTabId(3),
    ]);
  });

  it('keeps each workspace and the Global dock separate', () => {
    const storage = createStorage();
    const before = restart(storage);
    before.setActiveWorkspace('ws-a');
    before.openTerminal();
    before.setActiveWorkspace('__global__');
    before.openTerminal();
    before.newTerminal();

    const after = restart(storage);
    expect(Object.keys(after.getSnapshot().terminalTabsByWorkspace).sort()).toEqual(['__global__', 'ws-a']);
    after.setActiveWorkspace('__global__');
    expect(after.getSnapshot().terminalTabs).toHaveLength(2);
  });

  it('forgets a closed terminal', () => {
    const storage = createStorage();
    const before = restart(storage);
    before.setActiveWorkspace('ws-a');
    before.openTerminal();
    before.closeTerminal(TERMINAL_TAB_ID);

    expect(restart(storage).getSnapshot().terminalTabsByWorkspace).toEqual({});
  });

  it('drops malformed entries and repairs the next ordinal', () => {
    const storage = createStorage({
      [DOCK_TERMINAL_STORAGE_KEY]: JSON.stringify({
        version: 1,
        workspaces: {
          'ws-a': {
            tabs: [
              { id: terminalTabId(4), ordinal: 4, agentType: 'codex' },
              { id: terminalTabId(4), ordinal: 4 },
              { id: 'bad', ordinal: 0 },
              'nope',
            ],
            activeTabId: 'missing',
            nextOrdinal: 2,
          },
          'ws-empty': { tabs: [] },
        },
      }),
    });

    expect(createDockTerminalPersistence(storage).load()).toEqual({
      'ws-a': {
        tabs: [{ id: terminalTabId(4), ordinal: 4 }],
        activeTabId: undefined,
        nextOrdinal: 5,
      },
    });
  });

  it('ignores unreadable or foreign data', () => {
    expect(createDockTerminalPersistence(createStorage({ [DOCK_TERMINAL_STORAGE_KEY]: '{' })).load()).toEqual({});
    expect(createDockTerminalPersistence(createStorage({
      [DOCK_TERMINAL_STORAGE_KEY]: JSON.stringify({ version: 99, workspaces: {} }),
    })).load()).toEqual({});
  });
});
