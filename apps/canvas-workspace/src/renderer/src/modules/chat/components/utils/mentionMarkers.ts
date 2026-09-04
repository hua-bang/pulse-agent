export const MENTION_RE = /@\[((?:[^\]]|\](?=\]))+)\]/g;

export interface ProtectedMentionMarkers {
  content: string;
  markers: Array<{ placeholder: string; marker: string }>;
}

/**
 * Replaces complete mention markers with Markdown-inert text tokens. The
 * original marker is restored only after Markdown rendering, so syntax in an
 * internal id (for example `__global_chat__`) cannot become HTML.
 */
export function protectMentionMarkers(content: string): ProtectedMentionMarkers {
  let prefix = 'PULSEMENTIONPLACEHOLDER';
  while (content.includes(prefix)) prefix += 'X';
  const markers: ProtectedMentionMarkers['markers'] = [];
  const protectedContent = content.replace(MENTION_RE, (marker) => {
    const placeholder = `${prefix}${markers.length}TOKEN`;
    markers.push({ placeholder, marker });
    return placeholder;
  });
  return { content: protectedContent, markers };
}

export function transformHtmlText(
  html: string,
  transform: (text: string) => string,
): string {
  return html
    .split(/(<[^>]*>)/)
    .map(part => part.startsWith('<') ? part : transform(part))
    .join('');
}

export function restoreMentionMarkersInText(
  html: string,
  markers: ProtectedMentionMarkers['markers'],
): string {
  return transformHtmlText(
    html,
    text => markers.reduce(
      (restored, { placeholder, marker }) => restored.split(placeholder).join(marker),
      text,
    ),
  );
}

/** Any placeholder left after text-node conversion came from a Markdown HTML
 * attribute. Restore it as inert encoded data, never executable chip markup. */
export function restoreMentionMarkersInAttributes(
  html: string,
  markers: ProtectedMentionMarkers['markers'],
): string {
  return markers.reduce(
    (restored, { placeholder, marker }) => (
      restored.split(placeholder).join(encodeURIComponent(marker))
    ),
    html,
  );
}

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
