import type { AgentChatContentBlock, AgentChatToolCall } from './agent-chat';

/** Pure updates keep already-published snapshots immutable. */
export function appendContentText(
  blocks: AgentChatContentBlock[],
  text: string,
): AgentChatContentBlock[] {
  if (!text) return blocks;
  const last = blocks[blocks.length - 1];
  return last?.type === 'text'
    ? [...blocks.slice(0, -1), { type: 'text', text: last.text + text }]
    : [...blocks, { type: 'text', text }];
}

export function appendContentTool(
  blocks: AgentChatContentBlock[],
  tool: Pick<AgentChatToolCall, 'id' | 'toolCallId'>,
): AgentChatContentBlock[] {
  const exists = blocks.some(block => block.type === 'tool' && (
    tool.toolCallId ? block.toolCallId === tool.toolCallId : block.toolId === tool.id
  ));
  return exists ? blocks : [...blocks, {
    type: 'tool', toolId: tool.id, toolCallId: tool.toolCallId,
  }];
}

export function contentText(blocks: AgentChatContentBlock[]): string {
  return blocks.flatMap(block => block.type === 'text' ? [block.text] : []).join('');
}

/** Backends may return only their last text step, or return text without streaming. */
export function finishContentBlocks(
  blocks: AgentChatContentBlock[],
  response: string,
): AgentChatContentBlock[] {
  const streamed = contentText(blocks);
  if (!response || streamed.endsWith(response)) return blocks;
  if (response.startsWith(streamed)) return appendContentText(blocks, response.slice(streamed.length));
  return appendContentText(blocks, response);
}

/** Apply a backend's public-text sanitization without restoring removed prose. */
export function retainContentText(
  blocks: AgentChatContentBlock[],
  text: string,
): AgentChatContentBlock[] {
  const start = contentText(blocks).indexOf(text);
  if (!text || start < 0) {
    return appendContentText(blocks.filter(block => block.type === 'tool'), text);
  }
  let offset = 0;
  return blocks.flatMap<AgentChatContentBlock>(block => {
    if (block.type === 'tool') return [block];
    const from = Math.max(0, start - offset);
    const to = Math.min(block.text.length, start + text.length - offset);
    offset += block.text.length;
    return to > from ? [{ type: 'text' as const, text: block.text.slice(from, to) }] : [];
  });
}

export type ChatContentGroup =
  | { type: 'text'; text: string }
  | { type: 'tools'; tools: AgentChatToolCall[] };

/** Only consecutive calls coalesce. Results resolve in-place, never completion order. */
export function groupContentBlocks(
  blocks: AgentChatContentBlock[],
  tools: AgentChatToolCall[],
): ChatContentGroup[] {
  const groups: ChatContentGroup[] = [];
  for (const block of blocks) {
    if (block.type === 'text') {
      groups.push(block);
      continue;
    }
    const tool = tools.find(candidate => block.toolCallId
      ? candidate.toolCallId === block.toolCallId
      : candidate.id === block.toolId);
    if (!tool) continue;
    const previous = groups[groups.length - 1];
    if (previous?.type === 'tools') previous.tools.push(tool);
    else groups.push({ type: 'tools', tools: [tool] });
  }
  return groups;
}
