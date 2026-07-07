export const MENTION_RE = /@\[((?:[^\]]|\](?=\]))+)\]/g;

export function encodeMentionPart(value: string): string {
  return encodeURIComponent(value);
}

export function decodeMentionPart(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function pipedMentionLabel(rawLabel: string, prefix: string, fallback: string): string {
  const body = rawLabel.slice(prefix.length);
  const pipeIndex = body.indexOf('|');
  if (pipeIndex < 0) return fallback;
  const label = body.slice(pipeIndex + 1);
  return label ? decodeMentionPart(label) : fallback;
}
