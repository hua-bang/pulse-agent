import { downloadMessageImage } from './feishu-client';

// Inbound image handling for the Feishu channel: pull the image_key(s) out of an
// `image` message or a `post`'s `img` elements, then download them to local temp
// files so the agent can read them with a vision tool. Kept out of
// feishu-channel.ts to keep that file focused on streaming + event routing.

interface FeishuMessageLike {
  message?: { message_type?: string; content?: string };
}

/** Collect image_keys from one Feishu message's raw content JSON. */
export function collectImageKeys(rawContent: string | undefined, messageType: string | undefined): string[] {
  let content: unknown;
  try {
    content = JSON.parse(rawContent ?? '{}');
  } catch {
    return [];
  }

  if (messageType === 'image') {
    const key = (content as Record<string, unknown>)?.image_key;
    return typeof key === 'string' && key.trim() ? [key] : [];
  }
  if (messageType === 'post') {
    const keys: string[] = [];
    collectPostImageKeys(content, keys);
    return keys;
  }
  return [];
}

/** Walk a post body, pushing the image_key of every `img` element. */
function collectPostImageKeys(node: unknown, out: string[]): void {
  if (!node) return;
  if (Array.isArray(node)) {
    for (const item of node) collectPostImageKeys(item, out);
    return;
  }
  if (typeof node !== 'object') return;

  const record = node as Record<string, unknown>;
  if (record.tag === 'img' && typeof record.image_key === 'string' && record.image_key.trim()) {
    out.push(record.image_key);
  }
  for (const key of ['content', 'elements', 'children']) {
    collectPostImageKeys(record[key], out);
  }
}

/** Image keys carried by a raw im.message.receive_v1 event (empty when none). */
export function extractInboundImageKeys(data: unknown): string[] {
  const message = (data as FeishuMessageLike)?.message;
  if (!message) return [];
  return collectImageKeys(message.content, message.message_type);
}

/**
 * Download each image_key to a local temp file, best-effort: a failed download
 * is logged and skipped rather than failing the whole message, so the agent
 * still gets the text and any images that did download.
 */
export async function downloadInboundImages(messageId: string, imageKeys: string[]): Promise<string[]> {
  const paths: string[] = [];
  for (const key of imageKeys) {
    try {
      paths.push(await downloadMessageImage(messageId, key));
    } catch (err) {
      console.error('[channel:feishu] failed to download inbound image', err);
    }
  }
  return paths;
}
