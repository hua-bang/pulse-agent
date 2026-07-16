import type { AgentContextTabRef } from '../../shared/agent-chat';

/**
 * Render the authoritative prompt block for right-dock tabs the user
 * `@`-mentioned. Like other mention blocks this injects lightweight pointers
 * plus the exact tool call to read each tab on demand — content is NOT dumped
 * into the prompt.
 *
 * `currentWorkspaceId` is the chat's own workspace; when a tab omits its
 * workspaceId we fall back to it so link/artifact/terminal reads resolve.
 */
export function formatReferencedTabsBlock(
  tabs: AgentContextTabRef[] = [],
  currentWorkspaceId?: string,
): string {
  if (tabs.length === 0) return '';
  const count = tabs.length;
  const noun = count === 1 ? 'tab' : 'tabs';
  const lines: string[] = [
    '',
    `## Referenced Tabs — ${count} ${noun}`,
    `The user \`@\`-mentioned ${count} right-dock ${noun} (the browser-like tabs at the top of the dock). ` +
      'These are PRIMARY context for the current message. To read a tab\'s live content, use the exact call listed for it — do not guess from the title:',
    '',
  ];

  for (const tab of tabs) {
    const ws = tab.workspaceId || currentWorkspaceId;
    const wsArg = ws ? `, workspaceId: "${ws}"` : '';
    let how: string;
    switch (tab.kind) {
      case 'link':
        how = `web page${tab.url ? ` (${tab.url})` : ''} — read with \`canvas_read_tab({ kind: "link", tabId: "${tab.id}"${wsArg} })\``;
        break;
      case 'artifact':
        how = `artifact — read with \`canvas_read_tab({ kind: "artifact", artifactId: "${tab.artifactId ?? ''}"${wsArg} })\``;
        break;
      case 'terminal':
        how = `terminal — read recent output with \`canvas_read_tab({ kind: "terminal", sessionId: "${tab.sessionId ?? ''}" })\``;
        break;
      case 'node-detail':
        how = `canvas node detail — read with \`canvas_read_node({ nodeId: "${tab.nodeId ?? ''}"${wsArg} })\``;
        break;
      default:
        how = 'unknown tab kind';
    }
    lines.push(`- **${tab.title}** (${tab.kind}) — ${how}`);
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}
