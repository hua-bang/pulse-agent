export const CHAT_TAB_ID = 'chat';
export const TERMINAL_TAB_ID = 'terminal';
export const LINK_TAB_ID = 'link';

export const terminalTabId = (ordinal: number): string =>
  ordinal === 1 ? TERMINAL_TAB_ID : `${TERMINAL_TAB_ID}:${ordinal}`;

export const isTerminalTabId = (id: string): boolean =>
  id === TERMINAL_TAB_ID || id.startsWith(`${TERMINAL_TAB_ID}:`);

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
