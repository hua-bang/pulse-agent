import type { ChatSeed, TagSummaryNode, TagSummaryRequest } from './types';

/** Hard caps so a large tag can't blow up the prompt. */
const MAX_NODES = 24;
const PER_NODE_CHARS = 1500;

function formatNodeBlock(node: TagSummaryNode, index: number): string {
  const content = node.content.trim();
  const body = content.length > PER_NODE_CHARS
    ? `${content.slice(0, PER_NODE_CHARS)}…（内容已截断）`
    : content || '（无正文）';
  const meta = [node.workspaceName, node.type].filter(Boolean).join(' · ');
  const heading = `### ${index + 1}. ${node.title || '（未命名）'}${meta ? `（${meta}）` : ''}`;
  return `${heading}\n${body}`;
}

/**
 * Build the first chat turn for "summarize this tag", opened from the graph.
 * The visible message stays a clean instruction; the node contents ride along
 * in `requestContext.injectedContext` so the chat surface isn't flooded with
 * raw material the user already sees in the graph.
 */
export function buildTagSummarySeed(req: TagSummaryRequest): ChatSeed {
  const total = req.nodes.length;
  const used = req.nodes.slice(0, MAX_NODES);
  const omitted = total - used.length;

  const injectedContext = [
    `以下是知识库中带有「${req.tagLabel}」标签的 ${total} 条节点的内容`
      + (omitted > 0 ? `（因数量较多，仅附上前 ${used.length} 条）` : '')
      + '：',
    '',
    used.map(formatNodeBlock).join('\n\n'),
  ].join('\n');

  const prompt = [
    `请基于「${req.tagLabel}」这个标签下的 ${total} 条内容做一次总结：`,
    '1. 先用 2-3 句话概括这个标签整体在讲什么；',
    '2. 再分点归纳其中的关键内容与共性；',
    '3. 最后指出有哪些值得补充、或彼此可以关联起来的地方。',
    '用中文回答，保持精炼。',
  ].join('\n');

  return {
    scope: { kind: 'global' },
    prompt,
    requestContext: { quickAction: 'summarize-tag', injectedContext },
  };
}
