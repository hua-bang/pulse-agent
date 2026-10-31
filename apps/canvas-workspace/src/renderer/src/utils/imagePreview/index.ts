import type { ImagePreview, RenderedImagePreview } from '../../types';
import { toFileUrl } from '../fileUrl';

// Large images show a bounded preview instead of the full-size decode. The
// main process caches previews; a worker here renders a missing one, so the
// decode runs on neither the main process loop nor the renderer UI thread.

type PreviewResult = { ok: boolean; preview?: ImagePreview; error?: string };

interface WorkerReply {
  id: number;
  rendered?: RenderedImagePreview;
  error?: string;
}

let worker: Worker | null = null;
let nextJobId = 0;
const waiting = new Map<number, (reply: WorkerReply) => void>();
// One render at a time bounds peak memory to a single full-size bitmap.
let renderQueue: Promise<unknown> = Promise.resolve();

const previewWorker = (): Worker => {
  if (!worker) {
    worker = new Worker(new URL('./preview.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<WorkerReply>) => {
      waiting.get(event.data.id)?.(event.data);
      waiting.delete(event.data.id);
    };
  }
  return worker;
};

const renderPreview = (filePath: string, maxDimension: number): Promise<RenderedImagePreview> => {
  const job = renderQueue.then(() => new Promise<RenderedImagePreview>((resolve, reject) => {
    const id = nextJobId++;
    waiting.set(id, (reply) => {
      if (reply.rendered) resolve(reply.rendered);
      else reject(new Error(reply.error ?? 'Image preview failed'));
    });
    previewWorker().postMessage({ id, url: toFileUrl(filePath), maxDimension });
  }));
  renderQueue = job.catch(() => undefined);
  return job;
};

const originalImage = (filePath: string): ImagePreview => ({
  path: filePath,
  generated: false,
  width: 0,
  height: 0,
  originalWidth: 0,
  originalHeight: 0,
});

/** Resolves to a preview path; an image that cannot be rendered keeps its original path. */
export const getImagePreview = async (filePath: string, maxDimension?: number): Promise<PreviewResult> => {
  const api = window.canvasWorkspace.file;
  const found = await api.getImagePreview(filePath, maxDimension);
  if (!found.ok || found.preview || !found.request) return found;
  const { cacheKey } = found.request;
  try {
    const rendered = await renderPreview(filePath, found.request.maxDimension);
    const stored = await api.storeImagePreview(filePath, cacheKey, rendered);
    return stored.ok ? stored : { ok: true, preview: originalImage(filePath) };
  } catch {
    return { ok: true, preview: originalImage(filePath) };
  }
};
