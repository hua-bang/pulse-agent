export function resolveDockWorkspaceId(
  activeView: string,
  activeCanvasWorkspaceId: string,
  chatWorkspaceId: string | null,
): string | null {
  return activeView === 'chat'
    ? chatWorkspaceId
    : activeCanvasWorkspaceId;
}
