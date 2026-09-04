const VSCODE_LINK_PROTOCOLS = new Set(['vscode:', 'vscode-insiders:']);

export function isVSCodeLink(raw: string): boolean {
  try {
    return VSCODE_LINK_PROTOCOLS.has(new URL(raw).protocol);
  } catch {
    return false;
  }
}
