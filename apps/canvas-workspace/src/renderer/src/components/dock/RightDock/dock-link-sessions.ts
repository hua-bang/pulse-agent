import type { DockPreviewTab } from './dock-types';

export type DockLinkTab = Extract<DockPreviewTab, { kind: 'link' }>;

/** Storage key used after link tabs became application-scoped. */
export const GLOBAL_DOCK_LINK_SESSION_KEY = '__global__';

export interface DockLinkSession {
  tabs: DockLinkTab[];
  activeTabId?: string;
  expanded?: boolean;
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

  /**
   * Return the application-wide link session.
   *
   * Version-1 sessions were keyed by workspace because the dock originally
   * treated browser tabs as workspace sessions. Flatten those records on
   * read, deduplicating exact URLs and allocating collision-safe ids. The
   * first write below compacts the migrated view into the global record.
   */
  getGlobal(): DockLinkSession {
    const ordered = [
      this.sessions[GLOBAL_DOCK_LINK_SESSION_KEY],
      ...Object.entries(this.sessions)
        .filter(([key]) => key !== GLOBAL_DOCK_LINK_SESSION_KEY)
        .map(([, session]) => session),
    ].filter((session): session is DockLinkSession => Boolean(session));

    const tabs: DockLinkTab[] = [];
    const idMap = new Map<string, string>();
    const activeCandidates: string[] = [];
    for (const session of ordered) {
      for (const tab of session.tabs) {
        const existing = tab.url
          ? tabs.find((candidate) => candidate.url === tab.url)
          : undefined;
        if (existing) {
          idMap.set(tab.id, existing.id);
          continue;
        }
        const id = allocateLinkTabId(tabs, tab.id);
        idMap.set(tab.id, id);
        tabs.push({
          ...tab,
          id,
          ...(tab.openerTabId
            ? { openerTabId: idMap.get(tab.openerTabId) ?? tab.openerTabId }
            : {}),
        });
      }
      if (session.activeTabId && session.tabs.some((tab) => tab.id === session.activeTabId)) {
        activeCandidates.push(idMap.get(session.activeTabId) ?? session.activeTabId);
      }
    }

    const activeTabId = activeCandidates.find((id) => tabs.some((tab) => tab.id === id));
    const expanded = ordered.find((session) => typeof session.expanded === 'boolean')?.expanded;
    return {
      tabs,
      activeTabId,
      ...(expanded === undefined ? {} : { expanded }),
    };
  }

  /** Persist the link session independently of the active Workspace. */
  captureGlobal(tabs: DockPreviewTab[], activeTabId: string, expanded?: boolean): void {
    const linkTabs = tabs.filter((tab): tab is DockLinkTab => tab.kind === 'link');
    const previous = this.getGlobal();
    const activeLinkId = linkTabs.some((tab) => tab.id === activeTabId)
      ? activeTabId
      : previous.activeTabId && linkTabs.some((tab) => tab.id === previous.activeTabId)
        ? previous.activeTabId
        : undefined;
    this.sessions = {
      [GLOBAL_DOCK_LINK_SESSION_KEY]: {
        tabs: linkTabs,
        activeTabId: activeLinkId,
        expanded: expanded ?? previous.expanded,
      },
    };
    try {
      this.persistence?.save(this.sessions);
    } catch {
      // Restoration is best-effort; unavailable storage must not break the dock.
    }
  }
}

function allocateLinkTabId(tabs: readonly { id: string }[], baseId: string): string {
  if (!tabs.some((tab) => tab.id === baseId)) return baseId;
  let suffix = 2;
  let id = `${baseId}:${suffix}`;
  while (tabs.some((tab) => tab.id === id)) {
    suffix += 1;
    id = `${baseId}:${suffix}`;
  }
  return id;
}
