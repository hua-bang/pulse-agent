import { useState, type DragEvent } from 'react';
import { FILE_PATH_DRAG_TYPE, readFilePathDrag } from '../../../../shared/dock/file-path-drag';
import { routeOsFiles } from '../../attachments/osFileTransfer';

interface Options {
  disabled: boolean;
  onAttachFiles?: (files: File[]) => void;
  onInsertFile?: (filePath: string, isDirectory?: boolean) => void;
}

const acceptsDrag = (dataTransfer: DataTransfer): boolean => (
  dataTransfer.types.includes('Files') || dataTransfer.types.includes(FILE_PATH_DRAG_TYPE)
);

/**
 * Accepts files on the chat composer. Entries dragged from a dock folder tab
 * become file mentions; OS files follow `routeOsFiles`, which paste shares.
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

    routeOsFiles(event.dataTransfer, { onAttachFiles, onInsertFile });
  };

  return { active, onDragOver, onDragLeave, onDrop };
};
