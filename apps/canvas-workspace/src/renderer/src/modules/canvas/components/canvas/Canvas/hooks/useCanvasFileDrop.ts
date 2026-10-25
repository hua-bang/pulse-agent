import { useEffect } from 'react';
import type { CanvasNode } from '../../../../../../types';
import type { AddNodeOptions } from '../../../../document/useCanvasContentCommands';
import { useAppShell } from '../../../../../../shared/appShell';
import { useI18n } from '../../../../../../i18n';
import { getNodeDefaultSize } from '../../../../../../utils/nodeFactory';
import { saveImageAsNodePatch } from '../../../../runtime/canvasImageFile';
import { findFreeSlot } from './nodePlacement';

type NodePatch = Pick<CanvasNode, 'width' | 'height' | 'title' | 'data'>;

interface Options {
  canvasId: string;
  containerRef: React.RefObject<HTMLDivElement>;
  /** The container ref is only attached once the canvas has loaded. */
  loaded: boolean;
  screenToCanvas: (x: number, y: number, container: HTMLElement) => { x: number; y: number };
  addNode: (
    type: CanvasNode['type'],
    x: number,
    y: number,
    options?: AddNodeOptions,
  ) => CanvasNode;
  nodesRef: React.MutableRefObject<CanvasNode[]>;
  /** Selects the dropped nodes once they exist. */
  setSelectedNodeIds: (ids: string[]) => void;
}

const DROP_TARGET_CLASS = 'canvas-container--file-drop';
const TEXT_FILE_PATTERN = /\.(md|markdown|txt)$/i;
/** Each extra dropped file starts this far below and right of the previous one. */
const CASCADE_STEP = 32;

const hasFiles = (event: DragEvent): boolean => (
  event.dataTransfer?.types.includes('Files') ?? false
);

const isTextFile = (file: File): boolean => (
  TEXT_FILE_PATTERN.test(file.name) || file.type === 'text/plain' || file.type === 'text/markdown'
);

interface DroppedNode {
  type: 'image' | 'file';
  patch: NodePatch;
  options?: Omit<AddNodeOptions, 'nodePatch'>;
}

/** A dropped text file becomes a note backed by its own new Markdown file. */
const createNote = async (file: File): Promise<DroppedNode> => {
  const content = await file.text();
  const title = file.name.replace(TEXT_FILE_PATTERN, '') || file.name;
  return {
    type: 'file',
    patch: {
      ...getNodeDefaultSize('file'),
      title,
      data: { filePath: '', content, saved: false, modified: false },
    },
    options: { fileName: title, fileContent: content },
  };
};

const createImage = async (canvasId: string, file: File): Promise<DroppedNode | null> => {
  const title = file.name.replace(/\.[^.]+$/, '') || file.name;
  const patch = await saveImageAsNodePatch(canvasId, file, title);
  return patch ? { type: 'image', patch } : null;
};

/**
 * Files dragged in from the OS land under the pointer: images become image
 * nodes and Markdown or text files become notes. Each file is one undo step.
 * Other file types are named in a notice instead of being dropped silently.
 */
export const useCanvasFileDrop = ({
  canvasId,
  containerRef,
  loaded,
  screenToCanvas,
  addNode,
  nodesRef,
  setSelectedNodeIds,
}: Options) => {
  const { notify } = useAppShell();
  const { t } = useI18n();

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const clearHighlight = () => container.classList.remove(DROP_TARGET_CLASS);
    const over = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      container.classList.add(DROP_TARGET_CLASS);
    };
    const leave = (event: DragEvent) => {
      const next = event.relatedTarget;
      if (next instanceof Node && container.contains(next)) return;
      clearHighlight();
    };
    const drop = (event: DragEvent) => {
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length === 0) return;
      event.preventDefault();
      event.stopPropagation();
      clearHighlight();

      const at = screenToCanvas(event.clientX, event.clientY, container);
      const supported = files.filter((file) => file.type.startsWith('image/') || isTextFile(file));
      const unsupported = files.filter((file) => !supported.includes(file));
      if (unsupported.length > 0) {
        notify({
          tone: 'info',
          title: t('canvas.fileDropUnsupported', { names: unsupported.map((file) => file.name).join(', ') }),
          description: t('canvas.fileDropUnsupportedDescription'),
        });
      }

      void (async () => {
        const created: CanvasNode[] = [];
        for (const [index, file] of supported.entries()) {
          try {
            const dropped = file.type.startsWith('image/')
              ? await createImage(canvasId, file)
              : await createNote(file);
            if (!dropped) throw new Error('save failed');
            const { patch } = dropped;
            const offset = index * CASCADE_STEP;
            const slot = findFreeSlot(
              nodesRef.current,
              at.x - patch.width / 2 + offset,
              at.y - patch.height / 2 + offset,
              patch.width,
              patch.height,
            );
            created.push(addNode(dropped.type, slot.x, slot.y, { ...dropped.options, nodePatch: patch }));
          } catch {
            notify({ tone: 'error', title: t('canvas.fileDropFailed', { name: file.name }) });
          }
        }
        if (created.length > 0) setSelectedNodeIds(created.map((node) => node.id));
      })();
    };

    container.addEventListener('dragover', over);
    container.addEventListener('dragleave', leave);
    container.addEventListener('drop', drop);
    return () => {
      clearHighlight();
      container.removeEventListener('dragover', over);
      container.removeEventListener('dragleave', leave);
      container.removeEventListener('drop', drop);
    };
  }, [addNode, canvasId, containerRef, loaded, nodesRef, notify, screenToCanvas, setSelectedNodeIds, t]);
};
