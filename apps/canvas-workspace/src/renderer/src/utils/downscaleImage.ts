/**
 * Downscale a base64 image so its longest edge is <= maxDim, re-encoding to a
 * web-safe format. Returns the original base64 unchanged when it's already
 * within bounds, when the format isn't safely rasterizable (e.g. gif/svg —
 * downscaling would drop animation/vectors), or when decoding/encoding fails —
 * so callers can use the result unconditionally. Runs in the renderer.
 */
export const downscaleImageBase64 = (
  base64: string,
  mime: string,
  maxDim = 1600,
): Promise<string> =>
  new Promise((resolve) => {
    // Only rasterize formats where a flat resize is lossless of intent.
    if (!/^image\/(png|jpe?g|webp)$/i.test(mime)) {
      resolve(base64);
      return;
    }
    const img = new Image();
    img.onload = () => {
      const longest = Math.max(img.width, img.height);
      if (!longest || longest <= maxDim) {
        resolve(base64);
        return;
      }
      const scale = maxDim / longest;
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(base64);
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      try {
        const type = /jpe?g/i.test(mime) ? 'image/jpeg' : /webp/i.test(mime) ? 'image/webp' : 'image/png';
        const quality = type === 'image/png' ? undefined : 0.9;
        const dataUrl = canvas.toDataURL(type, quality);
        resolve(dataUrl.split(',')[1] || base64);
      } catch {
        resolve(base64);
      }
    };
    img.onerror = () => resolve(base64);
    img.src = `data:${mime};base64,${base64}`;
  });
