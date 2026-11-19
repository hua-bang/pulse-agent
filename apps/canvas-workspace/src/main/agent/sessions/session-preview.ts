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
export interface SessionPreviewAttachment {
  fileName?: string;
  path?: string;
}

/**
 * Derive a session preview from the first user message. Falls back to the
 * first attached image name (or a generic image label) when the user sent
 * images with no text so image-only chats remain distinguishable in history.
 */
export function sessionPreviewForMessage(
  message: { content: string; attachments?: SessionPreviewAttachment[] } | undefined,
  proseMaxLength = 50,
): string {
  if (!message) return '';
  if (message.content.trim()) return sessionPreview(message.content, proseMaxLength);
  const attachments = message.attachments;
  if (!attachments?.length) return '';
  const firstName = attachments[0]?.fileName?.trim()
    || attachments[0]?.path?.split(/[\\/]/).pop()?.trim();
  const base = firstName || 'Image';
  const label = attachments.length > 1 ? `${base} (+${attachments.length - 1})` : base;
  return label.length > proseMaxLength ? label.slice(0, proseMaxLength) : label;
}

export function sessionPreview(content: string, proseMaxLength = 50): string {
  const leadingMention = content.match(LEADING_MENTION_RE);
  if (!leadingMention) return cutProse(content, proseMaxLength);

  const prose = content.slice(leadingMention[0].length).trimStart();
  return `${leadingMention[1]}${prose ? ` ${cutProse(prose, proseMaxLength)}` : ''}`;
}
