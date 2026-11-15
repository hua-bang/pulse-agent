interface TransferredOsFile {
  file: File;
  isDirectory: boolean;
}

export interface OsFileTargets {
  onAttachFiles?: (files: File[]) => void;
  onInsertFile?: (filePath: string, isDirectory?: boolean) => void;
}

/**
 * Directory detection must run while the drop or paste event is still
 * dispatching; the entries are gone afterwards.
 */
const readOsFiles = (dataTransfer: DataTransfer): TransferredOsFile[] => {
  const items = Array.from(dataTransfer.items ?? []).filter(item => item.kind === 'file');
  if (items.length === 0) {
    return Array.from(dataTransfer.files ?? []).map(file => ({ file, isDirectory: false }));
  }
  return items.flatMap((item) => {
    const file = item.getAsFile();
    if (!file) return [];
    const entry = typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null;
    return [{ file, isDirectory: entry?.isDirectory === true }];
  });
};

/**
 * Routes OS files from a drop or a paste into the chat composer. Images
 * become attachments; other files and folders with a real path become file
 * mentions. A file without a path (for example one from a web page) is
 * skipped unless it is an image.
 *
 * Returns true when at least one file was routed, so a paste caller knows
 * whether to fall back to the clipboard text (Finder also puts the file
 * name there).
 */
export const routeOsFiles = (
  dataTransfer: DataTransfer,
  { onAttachFiles, onInsertFile }: OsFileTargets,
): boolean => {
  const images: File[] = [];
  let routed = false;
  for (const { file, isDirectory } of readOsFiles(dataTransfer)) {
    if (!isDirectory && file.type.startsWith('image/') && onAttachFiles) {
      images.push(file);
      continue;
    }
    const filePath = window.canvasWorkspace?.file?.getPathForFile?.(file) ?? '';
    if (filePath && onInsertFile) {
      onInsertFile(filePath, isDirectory);
      routed = true;
    }
  }
  if (images.length > 0) {
    onAttachFiles?.(images);
    routed = true;
  }
  return routed;
};
