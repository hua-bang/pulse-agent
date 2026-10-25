import type { CanvasNode } from '../../../types';

/** Clamp a new image to a reasonable default on-canvas size while
 *  preserving its aspect ratio. Very tall/wide images are still viewable
 *  without filling the screen, and small icons keep their native dimensions. */
const MAX_DEFAULT_DIM = 480;

const fitDimensions = (w: number, h: number): { width: number; height: number } => {
  if (w <= 0 || h <= 0) return { width: 320, height: 240 };
  const largest = Math.max(w, h);
  if (largest <= MAX_DEFAULT_DIM) return { width: w, height: h };
  const scale = MAX_DEFAULT_DIM / largest;
  return { width: Math.round(w * scale), height: Math.round(h * scale) };
};

const readAsDataUrl = (blob: Blob): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result as string);
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(blob);
});

const measureImage = (dataUrl: string): Promise<{ width: number; height: number }> => (
  new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(fitDimensions(img.naturalWidth, img.naturalHeight));
    img.onerror = () => resolve({ width: 320, height: 240 });
    img.src = dataUrl;
  })
);

/**
 * Save an image blob into the workspace and return the patch for a new image
 * node, sized to the image. Pasted and dropped images share this path so both
 * produce the same node.
 */
export const saveImageAsNodePatch = async (
  canvasId: string,
  blob: Blob,
  title?: string,
): Promise<Pick<CanvasNode, 'width' | 'height' | 'title' | 'data'> | null> => {
  const api = window.canvasWorkspace?.file;
  if (!api) return null;
  const dataUrl = await readAsDataUrl(blob);
  const base64 = dataUrl.split(',')[1];
  if (!base64) return null;
  const ext = blob.type.replace('image/', '').split(';')[0] || 'png';
  const saved = await api.saveImage(canvasId, base64, ext);
  if (!saved.ok || !saved.filePath) return null;
  const { width, height } = await measureImage(dataUrl);
  return {
    width,
    height,
    title: title ?? saved.fileName ?? 'Image',
    data: { filePath: saved.filePath },
  };
};
