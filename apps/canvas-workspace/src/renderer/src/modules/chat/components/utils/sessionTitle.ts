import { DOM_MENTION_PREFIX, TAB_MENTION_PREFIX } from '../ChatMentionPopup/constants';
import { MENTION_RE, pipedMentionLabel } from './mentionMarkers';
import { parseTabMention } from './tabMentions';

export interface SessionTitlePart {
  text: string;
  marker?: string;
}

function markerLabel(rawMarker: string): string {
  if (rawMarker.startsWith(DOM_MENTION_PREFIX)) {
    return pipedMentionLabel(rawMarker, DOM_MENTION_PREFIX, 'DOM selection');
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
  if (lastIndex < value.length) parts.push({ text: value.slice(lastIndex) });
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
