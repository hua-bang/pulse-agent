export const selectImageSource = (
  originalPath: string,
  previewPath: string | null,
  isFullscreen: boolean,
  previewResolved = true,
): string => {
  if (isFullscreen) return originalPath;
  if (!previewResolved) return '';
  return previewPath ?? originalPath;
};
