import type { MindmapTopic, RawMindmapTopic } from '../types';

let topicIdCounter = 0;
export function genTopicId(): string {
  return `topic-${Date.now()}-${++topicIdCounter}`;
}

/**
 * Normalize an LLM-supplied topic tree into the renderer's `MindmapTopic`
 * shape. We mint a fresh id when the model didn't supply one, default
 * text/children to safe values, and recursively walk the children so the
 * whole subtree is renderer-ready before it lands in canvas.json.
 */
export function normalizeMindmapTopic(raw: RawMindmapTopic | null | undefined): MindmapTopic {
  const safe = raw ?? {};
  const topic: MindmapTopic = {
    id: typeof safe.id === 'string' && safe.id ? safe.id : genTopicId(),
    text: typeof safe.text === 'string' ? safe.text : '',
    children: Array.isArray(safe.children) ? safe.children.map(normalizeMindmapTopic) : [],
  };
  if (typeof safe.color === 'string') topic.color = safe.color;
  if (safe.collapsed) topic.collapsed = true;
  return topic;
}

export function flattenMindmapForPrompt(topic: MindmapTopic | undefined, depth = 0): string {
  if (!topic) return '';
  const indent = '  '.repeat(depth);
  const collapsedHint = topic.collapsed ? ' [collapsed in UI]' : '';
  const lines = [`${indent}- ${topic.text?.trim() || '(empty topic)'}${collapsedHint}`];
  for (const child of topic.children ?? []) {
    lines.push(flattenMindmapForPrompt(child, depth + 1));
  }
  return lines.join('\n');
}
