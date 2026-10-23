import { useEffect, useState } from 'react';

const SAMPLE_SIZE = 16;
const tintCache = new Map<string, Promise<string | null>>();

/**
 * The favicon's main color: the saturation-weighted average of its opaque,
 * colored pixels. Near-white, near-black, and gray pixels are skipped, so a
 * logo on a white tile still yields the logo color. Null for a gray icon.
 */
export const pickFaviconTint = (pixels: Uint8ClampedArray): string | null => {
  let r = 0;
  let g = 0;
  let b = 0;
  let weight = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] < 128) continue;
    const max = Math.max(pixels[i], pixels[i + 1], pixels[i + 2]);
    const min = Math.min(pixels[i], pixels[i + 1], pixels[i + 2]);
    const saturation = (max - min) / 255;
    if (saturation < 0.2 || max < 30 || min > 235) continue;
    r += pixels[i] * saturation;
    g += pixels[i + 1] * saturation;
    b += pixels[i + 2] * saturation;
    weight += saturation;
  }
  if (weight === 0) return null;
  return `rgb(${Math.round(r / weight)} ${Math.round(g / weight)} ${Math.round(b / weight)})`;
};

// Pixel reads need a CORS-clean image. A favicon host that does not allow
// it taints the canvas; the read throws and the card stays neutral.
const loadTint = (url: string): Promise<string | null> => new Promise((resolve) => {
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.onload = () => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = SAMPLE_SIZE;
      canvas.height = SAMPLE_SIZE;
      const context = canvas.getContext('2d');
      if (!context) return resolve(null);
      context.drawImage(image, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
      resolve(pickFaviconTint(context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data));
    } catch {
      resolve(null);
    }
  };
  image.onerror = () => resolve(null);
  image.src = url;
});

/** Main color of a favicon for the overview card; one load per url per session. */
export const useFaviconTint = (url: string | undefined): string | null => {
  const [tint, setTint] = useState<string | null>(null);
  useEffect(() => {
    setTint(null);
    if (!url) return undefined;
    let cancelled = false;
    let pending = tintCache.get(url);
    if (!pending) {
      pending = loadTint(url);
      tintCache.set(url, pending);
    }
    void pending.then((value) => {
      if (!cancelled) setTint(value);
    });
    return () => {
      cancelled = true;
    };
  }, [url]);
  return tint;
};
