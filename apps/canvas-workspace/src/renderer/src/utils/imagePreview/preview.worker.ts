// Decodes and scales one image off the renderer's main thread. The full-size
// bitmap lives only for one request.

interface PreviewJob {
  id: number;
  url: string;
  maxDimension: number;
}

const render = async ({ url, maxDimension }: PreviewJob) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not read image (${response.status})`);
  const bitmap = await createImageBitmap(await response.blob());
  try {
    const originalWidth = bitmap.width;
    const originalHeight = bitmap.height;
    const longest = Math.max(originalWidth, originalHeight);
    if (longest <= maxDimension) {
      return { width: originalWidth, height: originalHeight, originalWidth, originalHeight };
    }
    const scale = maxDimension / longest;
    const width = Math.max(1, Math.round(originalWidth * scale));
    const height = Math.max(1, Math.round(originalHeight * scale));
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('No 2D context for image preview');
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    const png = new Uint8Array(await blob.arrayBuffer());
    return { png, width, height, originalWidth, originalHeight };
  } finally {
    bitmap.close();
  }
};

self.onmessage = (event: MessageEvent<PreviewJob>) => {
  const { id } = event.data;
  render(event.data).then(
    (rendered) => self.postMessage(
      { id, rendered },
      { transfer: rendered.png ? [rendered.png.buffer] : [] },
    ),
    (error: unknown) => self.postMessage({ id, error: String(error) }),
  );
};
