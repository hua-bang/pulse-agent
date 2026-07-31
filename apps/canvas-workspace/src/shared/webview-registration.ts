/**
 * Product surface hosting an Electron `<webview>` guest.
 *
 * Canvas nodes are previews embedded in the spatial canvas; dock browsers are
 * user-controlled browsing surfaces. Main uses this distinction for policies
 * that must not be inferred from URL or renderer timing.
 */
export type WebviewSurfaceKind = 'canvas-node' | 'dock-browser';

export const DEFAULT_WEBVIEW_SURFACE_KIND: WebviewSurfaceKind = 'canvas-node';

export interface WebviewRegistrationIdentity {
  readonly workspaceId: string;
  readonly nodeId: string;
  readonly webContentsId: number;
  readonly surfaceKind: WebviewSurfaceKind;
}

export type WebviewInstanceIdentity = Pick<
  WebviewRegistrationIdentity,
  'workspaceId' | 'nodeId' | 'webContentsId'
>;

/** Stable per-guest key for lifecycle state. Node identity alone is not
 * unique because one node may be presented on canvas and in the dock at the
 * same time. */
export const webviewInstanceKey = (identity: WebviewInstanceIdentity): string => (
  `${identity.workspaceId}::${identity.nodeId}::wc#${identity.webContentsId}`
);

export interface WebviewRegistrationRequest {
  workspaceId: string;
  nodeId: string;
  webContentsId: number;
  surfaceKind?: WebviewSurfaceKind;
  ready?: boolean;
}

export const isWebviewSurfaceKind = (value: unknown): value is WebviewSurfaceKind => (
  value === 'canvas-node' || value === 'dock-browser'
);
