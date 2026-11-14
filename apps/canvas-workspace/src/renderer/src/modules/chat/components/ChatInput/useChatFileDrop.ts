import { useState, type DragEvent } from 'react';
import { FILE_PATH_DRAG_TYPE, readFilePathDrag } from '../../../../shared/dock/file-path-drag';

interface Options {
  disabled: boolean;
  onAttachFiles?: (files: File[]) => void;
  onInsertFile?: (filePath: string, isDirectory?: boolean) => void;
}

interface DroppedOsFile {
  file: File;
  isDirectory: boolean;
}

const acceptsDrag = (dataTransfer: DataTransfer): boolean => (
  dataTransfer.types.includes('Files') || dataTransfer.types.includes(FILE_PATH_DRAG_TYPE)
);

/** Directory detection must run while the drop event is still dispatching. */
const readOsFiles = (dataTransfer: DataTransfer): DroppedOsFile[] => {
  const items = Array.from(dataTransfer.items ?? []).filter(item => item.kind === 'file');
  if (items.length === 0) {
    return Array.from(dataTransfer.files).map(file => ({ file, isDirectory: false }));
  }
  return items.flatMap((item) => {
    const file = item.getAsFile();
    if (!file) return [];
    const entry = typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null;
    return [{ file, isDirectory: entry?.isDirectory === true }];
  });
};

/**
 * Accepts files on the chat composer. OS images become attachments; other OS
 * files and folders, and entries dragged from a dock folder tab, become file
 * mentions. A file without a real path (for example one dragged from a web
 * page) is skipped unless it is an image.
 */
export const useChatFileDrop = ({ disabled, onAttachFiles, onInsertFile }: Options) => {
  const [active, setActive] = useState(false);
  const enabled = !disabled && Boolean(onAttachFiles || onInsertFile);

  const onDragOver = (event: DragEvent<HTMLElement>) => {
    if (!enabled || !acceptsDrag(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    if (!active) setActive(true);
  };

  const onDragLeave = (event: DragEvent<HTMLElement>) => {
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) return;
    setActive(false);
  };

  const onDrop = (event: DragEvent<HTMLElement>) => {
    setActive(false);
    if (!enabled || !acceptsDrag(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();

    const treeEntry = readFilePathDrag(event.dataTransfer);
    if (treeEntry) {
      onInsertFile?.(treeEntry.path, treeEntry.isDirectory);
      return;
    }

    const images: File[] = [];
    for (const { file, isDirectory } of readOsFiles(event.dataTransfer)) {
      if (!isDirectory && file.type.startsWith('image/') && onAttachFiles) {
        images.push(file);
        continue;
      }
      const filePath = window.canvasWorkspace?.file?.getPathForFile?.(file) ?? '';
      if (filePath) onInsertFile?.(filePath, isDirectory);
    }
    if (images.length > 0) onAttachFiles?.(images);
  };

  return { active, onDragOver, onDragLeave, onDrop };
};
