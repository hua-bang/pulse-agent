export interface CanvasAgentDomSelection {
  id: string;
  label: string;
  workspaceId?: string;
  nodeId: string;
  nodeTitle?: string;
  url?: string;
  selector: string;
  tagName?: string;
  text?: string;
  html?: string;
}

function promptInline(value: string | undefined): string {
  return (value ?? '').replace(/`/g, '\\`').trim();
}

function promptExcerpt(value: string | undefined, maxChars = 900): string {
  const text = (value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > maxChars ? `${text.slice(0, maxChars)}...` : text;
}

export function formatDomSelectionFocusBlock(
  domSelections: CanvasAgentDomSelection[] = [],
  options: { requireWorkspaceId: boolean },
): string {
  if (domSelections.length === 0) return '';
  const count = domSelections.length;
  const noun = count === 1 ? 'DOM selection' : 'DOM selections';
  const lines: string[] = [
    '',
    `## Current Focus — ${count} Selected Web ${noun}`,
    'The user picked specific DOM element(s) inside iframe/webview canvas nodes. Treat these DOM selections as primary context for phrases like "this area", "this button", "this table", "选中的区域", and "这个网页区域".',
    'Selected DOM elements:',
  ];
  for (const item of domSelections) {
    const workspacePart = item.workspaceId ? `, workspaceId: \`${promptInline(item.workspaceId)}\`` : '';
    const nodeTitle = item.nodeTitle ? `, node: **${promptInline(item.nodeTitle)}**` : '';
    const tag = item.tagName ? `, tag: \`${promptInline(item.tagName)}\`` : '';
    lines.push(
      `- **${promptInline(item.label)}** — nodeId: \`${promptInline(item.nodeId)}\`${workspacePart}${nodeTitle}${tag}`,
    );
    lines.push(`  selector: \`${promptInline(item.selector)}\``);
    if (item.url) lines.push(`  url: ${item.url}`);
    const excerpt = promptExcerpt(item.text);
    if (excerpt) lines.push(`  text excerpt: ${excerpt}`);
  }
  lines.push('');
  lines.push(
    options.requireWorkspaceId
      ? 'When you need fresh or exact content for a selected DOM element, call `canvas_read_dom_selection` with the listed `workspaceId`, `nodeId`, and `selector`.'
      : 'When you need fresh or exact content for a selected DOM element, call `canvas_read_dom_selection` with the listed `nodeId` and `selector`.',
  );
  return lines.join('\n') + '\n';
}
