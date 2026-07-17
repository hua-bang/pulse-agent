import type { DockPreviewTab } from './dock-types';

export type DockLinkTab = Extract<DockPreviewTab, { kind: 'link' }>;

export interface DockLinkSession {
  tabs: DockLinkTab[];
  activeTabId?: string;
}

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

  get(workspaceId: string): DockLinkSession | undefined {
    return this.sessions[workspaceId];
  }

  capture(workspaceId: string, tabs: DockPreviewTab[], activeTabId: string): void {
    if (!workspaceId || workspaceId === '__default__') return;
    const linkTabs = tabs.filter((tab): tab is DockLinkTab => tab.kind === 'link');
    this.sessions = {
      ...this.sessions,
      [workspaceId]: {
        tabs: linkTabs,
        activeTabId: linkTabs.some((tab) => tab.id === activeTabId) ? activeTabId : undefined,
      },
    };
    try {
      this.persistence?.save(this.sessions);
    } catch {
      // Restoration is best-effort; unavailable storage must not break the dock.
    }
  }
}
