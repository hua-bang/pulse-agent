import { NODE_MENTION_PREFIX } from '../components/ChatMentionPopup/constants';
import { decodeMentionPart, encodeMentionPart } from './mentionMarkers';

export interface NodeMentionRef {
  nodeId: string;
  workspaceId?: string;
  label: string;
}

/**
 * Escape only the characters that would break the marker (`|` splits the
 * label, `]` ends the marker, `%` keeps decoding lossless). Everything else
 * stays readable, because the model reads the label as prose.
 */
const escapeNodeLabel = (label: string): string =>
  label.replace(/[%|\]]/g, char => encodeURIComponent(char));

/**
 * `@[node:<nodeId>|<label>]`, or `@[node:<workspaceId>:<nodeId>|<label>]` for
 * a node from another workspace. The id keeps the chip resolvable after the
 * node is renamed or when titles collide; the label is display text only.
 */
export function buildNodeMentionMarker(ref: NodeMentionRef): string {
  const idPart = ref.workspaceId
    ? `${encodeMentionPart(ref.workspaceId)}:${encodeMentionPart(ref.nodeId)}`
    : encodeMentionPart(ref.nodeId);
  return `${NODE_MENTION_PREFIX}${idPart}|${escapeNodeLabel(ref.label)}`;
}

/** Parse a marker body (`node:...`, without `@[` / `]`); null when malformed. */
export function parseNodeMention(rawLabel: string): NodeMentionRef | null {
  if (!rawLabel.startsWith(NODE_MENTION_PREFIX)) return null;
  const body = rawLabel.slice(NODE_MENTION_PREFIX.length);
  const pipeIndex = body.indexOf('|');
  const idPart = pipeIndex >= 0 ? body.slice(0, pipeIndex) : body;
  const segments = idPart.split(':').map(decodeMentionPart);
  if (segments.length > 2 || segments.some(segment => !segment)) return null;
  const [first, second] = segments;
  const nodeId = second ?? first;
  const label = pipeIndex >= 0 ? decodeMentionPart(body.slice(pipeIndex + 1)) : '';
  return {
    nodeId,
    ...(second ? { workspaceId: first } : {}),
    label: label || nodeId,
  };
}
