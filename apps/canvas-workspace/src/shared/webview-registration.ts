/**
 * Product surface hosting an Electron `<webview>` guest.
 *
 * Canvas nodes are previews embedded in the spatial canvas; dock browsers are
 * user-controlled browsing surfaces. Plugin pages are web views that an
 * installed plugin shows on its own page through the host `WebView`
 * component. Main uses this distinction for policies
 * that must not be inferred from URL or renderer timing.
 */
export type WebviewSurfaceKind = 'canvas-node' | 'dock-browser' | 'plugin-page';

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
  value === 'canvas-node' || value === 'dock-browser' || value === 'plugin-page'
);

/**
 * Plugin pages belong to the app, not to a canvas workspace. They register
 * under this reserved workspace id, so a workspace id never collides with
 * them and no workspace activation is attempted to read them.
 */
export const PLUGIN_PAGE_WORKSPACE_ID = '__plugin-pages__';

const PLUGIN_PAGE_PART_RE = /^[a-z0-9][a-z0-9.-]{0,63}$/;
const PLUGIN_PAGE_TARGET_RE = /^plugin:([^/]+)\/([^/]+)$/;

export const DEFAULT_PLUGIN_PAGE_VIEW_ID = 'main';

export interface PluginPageTarget {
  pluginId: string;
  viewId: string;
}

/** Valid plugin ids and view ids: 1-64 lowercase letters, digits, periods, or hyphens. */
export const isPluginPagePart = (value: unknown): value is string => (
  typeof value === 'string' && PLUGIN_PAGE_PART_RE.test(value)
);

/** Stable target id that agents and CLI callers pass as `nodeId`. */
export const pluginPageTargetId = ({ pluginId, viewId }: PluginPageTarget): string => (
  `plugin:${pluginId}/${viewId}`
);

export const parsePluginPageTargetId = (value: string): PluginPageTarget | null => {
  const match = PLUGIN_PAGE_TARGET_RE.exec(value.trim());
  if (!match || !isPluginPagePart(match[1]) || !isPluginPagePart(match[2])) return null;
  return { pluginId: match[1], viewId: match[2] };
};

/**
 * Registry key for a read target. A plugin page target resolves to the
 * reserved plugin workspace whatever workspace the caller is in; every
 * other target keeps the caller's workspace.
 */
export const webviewRegistryKeyFor = (
  workspaceId: string,
  nodeId: string,
): { workspaceId: string; nodeId: string; isPluginPage: boolean } => {
  const target = parsePluginPageTargetId(nodeId);
  return target
    ? { workspaceId: PLUGIN_PAGE_WORKSPACE_ID, nodeId: pluginPageTargetId(target), isPluginPage: true }
    : { workspaceId, nodeId, isPluginPage: false };
};

/**
 * A registration is consistent when its surface kind is known and the
 * plugin workspace holds plugin pages only, each under a valid target id.
 */
export const isConsistentWebviewRegistration = (
  request: Pick<WebviewRegistrationRequest, 'workspaceId' | 'nodeId' | 'surfaceKind'>,
): boolean => {
  if (request.surfaceKind !== undefined && !isWebviewSurfaceKind(request.surfaceKind)) return false;
  const inPluginWorkspace = request.workspaceId === PLUGIN_PAGE_WORKSPACE_ID;
  if ((request.surfaceKind === 'plugin-page') !== inPluginWorkspace) return false;
  return !inPluginWorkspace || parsePluginPageTargetId(request.nodeId) !== null;
};
