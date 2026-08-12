import type { DockPreviewTab } from './dock-types';

export type DockLinkTab = Extract<DockPreviewTab, { kind: 'link' }>;

export interface DockLinkSession {
  tabs: DockLinkTab[];
  activeTabId?: string;
  expanded?: boolean;
}

/** Link-tab sessions keyed by a Dock scope key: a real workspace id or the
 * workspace-independent global Dock key. */
export type DockLinkSessions = Record<string, DockLinkSession>;

export interface DockSessionPersistence {
  load: () => DockLinkSessions;
  save: (sessions: DockLinkSessions) => void;
}

export class DockLinkSessionStore {
  private sessions: DockLinkSessions;

  constructor(private readonly persistence?: DockSessionPersistence) {
    try {
      this.sessions = persistence?.load() ?? {};
    } catch {
      this.sessions = {};
    }
  }

  get(scopeKey: string): DockLinkSession | undefined {
    return this.sessions[scopeKey];
  }

  capture(scopeKey: string, tabs: DockPreviewTab[], activeTabId: string, expanded?: boolean): void {
    if (!scopeKey || scopeKey === '__default__') return;
    const linkTabs = tabs.filter((tab): tab is DockLinkTab => tab.kind === 'link');
    const previous = this.sessions[scopeKey];
    const activeLinkId = linkTabs.some((tab) => tab.id === activeTabId)
      ? activeTabId
      : previous?.activeTabId && linkTabs.some((tab) => tab.id === previous.activeTabId)
        ? previous.activeTabId
        : undefined;
    this.sessions = {
      ...this.sessions,
      [scopeKey]: {
        tabs: linkTabs,
        activeTabId: activeLinkId,
        expanded: expanded ?? previous?.expanded,
      },
    };
    try {
      this.persistence?.save(this.sessions);
    } catch {
      // Restoration is best-effort; unavailable storage must not break the dock.
    }
  }
}
