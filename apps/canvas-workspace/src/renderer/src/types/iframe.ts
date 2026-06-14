export interface IframeApi {
  registerWebview: (
    workspaceId: string,
    nodeId: string,
    webContentsId: number,
  ) => Promise<{ ok: boolean }>;
  unregisterWebview: (
    workspaceId: string,
    nodeId: string,
  ) => Promise<{ ok: boolean }>;
}
