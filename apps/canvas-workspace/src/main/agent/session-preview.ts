const LEADING_MENTION_RE = /^\s*(@\[((?:[^\]]|\](?=\]))+)\])/;

/**
 * Keep a leading composer marker intact so the renderer can turn it into a
 * reference chip. Only the prose after it is length-limited for list density.
 */
export function sessionPreview(content: string, proseMaxLength = 50): string {
  const leadingMention = content.match(LEADING_MENTION_RE);
  if (!leadingMention) return content.slice(0, proseMaxLength);

  const prose = content.slice(leadingMention[0].length).trimStart();
  return `${leadingMention[1]}${prose ? ` ${prose.slice(0, proseMaxLength)}` : ''}`;
}
