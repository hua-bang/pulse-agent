const LEADING_MENTION_RE = /^\s*(@\[((?:[^\]]|\](?=\]))+)\])/;
const MENTION_SPAN_RE = /@\[((?:[^\]]|\](?=\]))+)\]/g;

/** Cut prose at `maxLength`, extending the cut past a marker it would split. */
function cutProse(prose: string, maxLength: number): string {
  if (prose.length <= maxLength) return prose;
  for (const match of prose.matchAll(MENTION_SPAN_RE)) {
    const start = match.index ?? 0;
    if (start >= maxLength) break;
    const end = start + match[0].length;
    if (end > maxLength) return prose.slice(0, end);
  }
  return prose.slice(0, maxLength);
}

/**
 * Keep composer markers intact so the renderer can turn them into reference
 * chips. Only the prose is length-limited for list density; a cut never
 * splits a marker, because a half marker renders as raw `@[node:…` text.
 */
export function sessionPreview(content: string, proseMaxLength = 50): string {
  const leadingMention = content.match(LEADING_MENTION_RE);
  if (!leadingMention) return cutProse(content, proseMaxLength);

  const prose = content.slice(leadingMention[0].length).trimStart();
  return `${leadingMention[1]}${prose ? ` ${cutProse(prose, proseMaxLength)}` : ''}`;
}
