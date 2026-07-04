import type { AgentContextDomSelectionRef } from '../../shared/agent-chat';

export type CanvasAgentDomSelection = AgentContextDomSelectionRef;

function promptInline(value: string | undefined): string {
  return (value ?? '').replace(/`/g, '\\`').trim();
}

function promptExcerpt(value: string | undefined, maxChars = 900): string {
  const text = (value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > maxChars ? `${text.slice(0, maxChars)}...` : text;
}

function promptJsonExcerpt(value: unknown, maxChars = 1500): string {
  if (value === undefined || value === null) return '';
  try {
    const text = JSON.stringify(value);
    return text.length > maxChars ? `${text.slice(0, maxChars)}...` : text;
  } catch {
    return '';
  }
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
    if (item.snapshot) {
      lines.push(
        `  snapshot: ${item.snapshot.nodeCount} nodes, ${item.snapshot.controlCount} controls${item.snapshot.truncated ? ', truncated' : ''}`,
      );
    }
    const controls = item.controls?.slice(0, 12);
    const controlsExcerpt = controls && controls.length > 0 ? promptJsonExcerpt(controls, 1200) : '';
    if (controlsExcerpt) lines.push(`  controls: ${controlsExcerpt}`);
    const treeExcerpt = item.tree ? promptJsonExcerpt(item.tree, 1600) : '';
    if (treeExcerpt) lines.push(`  structured tree excerpt: ${treeExcerpt}`);
  }
  lines.push('');
  lines.push(
    options.requireWorkspaceId
      ? 'When you need fresh or exact content for a selected DOM element, call `canvas_read_dom_selection` with the listed `workspaceId`, `nodeId`, and `selector`.'
      : 'When you need fresh or exact content for a selected DOM element, call `canvas_read_dom_selection` with the listed `nodeId` and `selector`.',
  );
  return lines.join('\n') + '\n';
}
