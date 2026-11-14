/**
 * Drag type for a file or folder dragged out of a dock folder tab. The
 * payload is `{ path, isDirectory }` as JSON. It carries no OS files, so
 * surfaces that only accept `Files` (such as the canvas) ignore it.
 */
export const FILE_PATH_DRAG_TYPE = 'application/x-pulse-file-path';

export interface FilePathDragPayload {
  path: string;
  isDirectory: boolean;
}

export const writeFilePathDrag = (
  dataTransfer: DataTransfer,
  payload: FilePathDragPayload,
): void => {
  dataTransfer.effectAllowed = 'copy';
  dataTransfer.setData(FILE_PATH_DRAG_TYPE, JSON.stringify(payload));
  dataTransfer.setData('text/plain', payload.path);
};

export const readFilePathDrag = (dataTransfer: DataTransfer): FilePathDragPayload | null => {
  try {
    const value: unknown = JSON.parse(dataTransfer.getData(FILE_PATH_DRAG_TYPE));
    if (!value || typeof value !== 'object') return null;
    const { path, isDirectory } = value as Record<string, unknown>;
    if (typeof path !== 'string' || !path) return null;
    return { path, isDirectory: isDirectory === true };
  } catch {
    return null;
  }
};
