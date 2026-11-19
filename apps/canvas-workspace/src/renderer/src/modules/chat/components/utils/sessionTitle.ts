import { DOM_MENTION_PREFIX, NODE_MENTION_PREFIX, TAB_MENTION_PREFIX } from '../ChatMentionPopup/constants';
import { MENTION_RE, pipedMentionLabel } from '../../mentions/mentionMarkers';
import { parseTabMention } from '../../mentions/tabMentions';

export interface SessionTitlePart {
  text: string;
  marker?: string;
}

function markerLabel(rawMarker: string): string {
  if (rawMarker.startsWith(DOM_MENTION_PREFIX)) {
    return pipedMentionLabel(rawMarker, DOM_MENTION_PREFIX, 'DOM selection');
  }
  if (rawMarker.startsWith(NODE_MENTION_PREFIX)) {
    return pipedMentionLabel(rawMarker, NODE_MENTION_PREFIX, 'Node');
  }
  if (rawMarker.startsWith(TAB_MENTION_PREFIX)) {
    return parseTabMention(rawMarker)?.label ?? 'Tab';
  }
  const pipeIndex = rawMarker.indexOf('|');
  return pipeIndex >= 0 ? rawMarker.slice(pipeIndex + 1) : rawMarker;
}

export function sessionTitleParts(value: string): SessionTitlePart[] {
  const parts: SessionTitlePart[] = [];
  let lastIndex = 0;

  value.replace(MENTION_RE, (marker, rawMarker: string, offset: number) => {
    if (offset > lastIndex) parts.push({ text: value.slice(lastIndex, offset) });
    parts.push({ text: markerLabel(rawMarker), marker: rawMarker });
    lastIndex = offset + marker.length;
    return marker;
  });
  if (lastIndex < value.length) {
    let tail = value.slice(lastIndex);
    // Older previews could cut a marker in half; show an ellipsis, not `@[node:…`.
    const dangling = tail.lastIndexOf('@[');
    if (dangling >= 0 && !tail.includes(']', dangling)) tail = `${tail.slice(0, dangling).trimEnd()}…`;
    parts.push({ text: tail });
  }
  return parts;
}

/** Readable fallback for a native title tooltip or accessibility label. */
export function sessionTitleText(value: string): string {
  return sessionTitleParts(value)
    .map((part) => part.text)
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Derive a session title source from a user message, falling back to image attachment labels. */
export function messageSessionTitleSource(
  message: { content: string; attachments?: Array<{ fileName?: string }> } | undefined,
  imageFallback: string,
): string | undefined {
  if (!message) return undefined;
  const trimmed = message.content.trim();
  if (trimmed) return trimmed;
  if (!message.attachments?.length) return undefined;
  const base = message.attachments[0]?.fileName?.trim() || imageFallback;
  return message.attachments.length > 1 ? `${base} (+${message.attachments.length - 1})` : base;
}
