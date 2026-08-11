/** Main → renderer request to activate one right-dock tab without navigation. */
export interface DockActivateTabRequest {
  requestId: string;
  workspaceId: string;
  tabId: string;
}

/** Renderer acknowledgement after the requested dock state is observable. */
export interface DockActivateTabResult extends DockActivateTabRequest {
  ok: boolean;
  error?: 'stale' | 'workspace-unavailable' | 'superseded';
}
