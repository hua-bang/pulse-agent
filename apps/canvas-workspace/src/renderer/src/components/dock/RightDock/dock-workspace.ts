export function resolveDockWorkspaceId(
  activeView: string,
  activeCanvasWorkspaceId: string,
  chatWorkspaceId: string | null,
): string {
  return activeView === 'chat' && chatWorkspaceId
    ? chatWorkspaceId
    : activeCanvasWorkspaceId;
}
