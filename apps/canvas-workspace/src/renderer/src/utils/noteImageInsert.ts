import { downscaleImageBase64 } from './downscaleImage';
import { toFileUrl } from './fileUrl';
import type { EditorView } from '@tiptap/pm/view';

/** Map an image mime type to a file extension (jpeg → jpg, default png). */
export const imageExtensionFromMime = (mimeType: string | undefined): string => {
  const normalized = (mimeType ?? '')
    .toLowerCase()
    .replace(/^image\//, '')
    .replace(/[^a-z0-9]/g, '');

  if (!normalized) return 'png';
  if (normalized === 'jpeg') return 'jpg';
  return normalized;
};

/** Derive the workspace id from an explicit value or the file path. */
export const resolveWorkspaceId = (
  explicit: string | null | undefined,
  filePath: string,
): string =>
  explicit ?? filePath.match(/canvas[/\\]([^/\\]+)[/\\]/)?.[1] ?? 'default';

const blobToBase64 = (blob: Blob): Promise<string | null> =>
  new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1] || null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(blob);
  });

/**
 * Downscale, persist, and return a `file://` src for an image blob — shared by
 * paste, drop, and the file picker. Returns null on any failure.
 */
export const saveImageBlob = async (blob: Blob, wsId: string): Promise<string | null> => {
  const base64 = await blobToBase64(blob);
  if (!base64) return null;
  const mime = blob.type || 'image/png';
  const scaled = await downscaleImageBase64(base64, mime);
  const api = window.canvasWorkspace?.file;
  if (!api) return null;
  const res = await api.saveImage(wsId, scaled, imageExtensionFromMime(mime));
  if (!res.ok || !res.filePath) return null;
  return toFileUrl(res.filePath);
};

const IMAGE_URL_RE = /^https?:\/\/\S+\.(?:png|jpe?g|gif|webp|svg)(?:\?\S*)?$/i;

/** True when text is a bare URL pointing at an image (for paste-to-embed). */
export const isImageUrl = (text: string): boolean => IMAGE_URL_RE.test(text.trim());

const createImageNode = (view: EditorView, src: string) =>
  view.state.schema.nodes['image']?.create({ src }) ?? null;

/** Replace the current selection with an image node. */
export const insertImageAtSelection = (view: EditorView, src: string): void => {
  const node = createImageNode(view, src);
  if (node) view.dispatch(view.state.tr.replaceSelectionWith(node));
};

/** Insert an image node at a document position (used for drag-and-drop). */
export const insertImageAtPos = (view: EditorView, src: string, pos: number): void => {
  const node = createImageNode(view, src);
  if (node) view.dispatch(view.state.tr.insert(pos, node));
};
