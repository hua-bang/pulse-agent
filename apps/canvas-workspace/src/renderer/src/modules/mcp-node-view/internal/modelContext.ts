import type { CanvasNode } from '../../../types';

const EXCERPT_LENGTH = 1_200;

interface Topic {
  text?: string;
  children?: Topic[];
}

function outline(topic: Topic | undefined, depth = 0): string[] {
  if (!topic) return [];
  const lines = [`${'  '.repeat(depth)}- ${topic.text?.trim() || '(empty)'}`];
  for (const child of topic.children ?? []) lines.push(...outline(child, depth + 1));
  return lines;
}

function plainText(html: string): string {
  return html
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/**
 * What the model should know about the node the user is looking at, so a
 * follow-up like "expand this" works after the user edits it in the view.
 */
export function describeNodeForModel(node: CanvasNode, workspace: { id?: string; name?: string }): string {
  const header = `The user is viewing the Pulse Canvas ${node.type} node "${node.title}" ` +
    `(nodeId: ${node.id}, workspaceId: ${workspace.id ?? 'unknown'}${workspace.name ? `, workspace "${workspace.name}"` : ''}).`;
  const data = node.data as unknown as Record<string, unknown>;
  let body = '';
  if (node.type === 'mindmap') body = outline(data.root as Topic | undefined).join('\n');
  else if (node.type === 'text') body = plainText(String(data.content ?? '')).trim();
  else if (node.type === 'file') body = String(data.content ?? '').trim();
  if (!body) return header;
  const excerpt = body.length > EXCERPT_LENGTH ? `${body.slice(0, EXCERPT_LENGTH)}…` : body;
  return `${header}\nCurrent content:\n${excerpt}`;
}
