export const CHAT_TAB_ID = 'chat';
export const TERMINAL_TAB_ID = 'terminal';
export const LINK_TAB_ID = 'link';

export const terminalTabId = (ordinal: number): string =>
  ordinal === 1 ? TERMINAL_TAB_ID : `${TERMINAL_TAB_ID}:${ordinal}`;

export const isTerminalTabId = (id: string): boolean =>
  id === TERMINAL_TAB_ID || id.startsWith(`${TERMINAL_TAB_ID}:`);

const dockElementIdPart = (tabId: string): string => encodeURIComponent(tabId);

/** Stable DOM id for the tab control represented by a dock tab id. */
export const dockTabElementId = (tabId: string): string =>
  `right-dock-tab-${dockElementIdPart(tabId)}`;

/**
 * Stable DOM id for the panel controlled by a dock tab. Terminal tabs share
 * one live terminal host, so every terminal tab controls that same panel.
 */
export const dockPaneElementId = (tabId: string): string =>
  isTerminalTabId(tabId)
    ? 'right-dock-pane-terminal'
    : `right-dock-pane-${dockElementIdPart(tabId)}`;

export const artifactTabId = (workspaceId: string, artifactId: string): string =>
  `artifact:${workspaceId}:${artifactId}`;

export const nodeDetailTabId = (workspaceId: string, nodeId: string): string =>
  `node-detail:${encodeURIComponent(workspaceId)}:${encodeURIComponent(nodeId)}`;

export const canvasPreviewTabId = (workspaceId: string): string =>
  `canvas:${encodeURIComponent(workspaceId)}`;

export const linkTabId = (url: string): string => {
  let hash = 2166136261;
  for (let i = 0; i < url.length; i += 1) {
    hash ^= url.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${LINK_TAB_ID}:${url.length.toString(36)}:${(hash >>> 0).toString(36)}`;
};
