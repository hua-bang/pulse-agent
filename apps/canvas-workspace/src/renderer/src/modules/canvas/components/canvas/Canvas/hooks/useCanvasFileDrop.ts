import { useEffect } from 'react';
import type { CanvasNode } from '../../../../../../types';
import type { AddNodeOptions } from '../../../../document/useCanvasContentCommands';
import { useAppShell } from '../../../../../../shared/appShell';
import { useI18n } from '../../../../../../i18n';
import { getNodeDefaultSize } from '../../../../../../utils/nodeFactory';
import { normalizeReferenceUrl } from '../../../../../../shared/reference/utils';
import { looksLikeUrl } from '../../../../../../platform/browser/address-input';
import { saveImageAsNodePatch } from '../../../../runtime/canvasImageFile';
import { createTextPatch } from '../../../../runtime/useCanvasImagePaste';
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
  /** Creates (and selects) a web node centred on `at`. */
  createUrlNode?: (url: string, options?: { at?: { x: number; y: number } }) => CanvasNode | null;
}

const DROP_TARGET_CLASS = 'canvas-container--file-drop';
const TEXT_FILE_PATTERN = /\.(md|markdown|txt)$/i;
/** Each extra dropped file starts this far below and right of the previous one. */
const CASCADE_STEP = 32;
/** A drop this large, or with several files, shows a progress toast. */
const PROGRESS_MIN_FILES = 2;
const PROGRESS_MIN_BYTES = 4 * 1024 * 1024;

/**
 * Data types that browsers and other apps put on an external text or link
 * drag. Any other type marks an in-app drag (for example a dock folder-tab
 * entry), which belongs to its own drop target.
 */
const EXTERNAL_TEXT_TYPES = new Set(['text/plain', 'text/uri-list', 'text/html', 'text/x-moz-url']);

const hasFiles = (event: DragEvent): boolean => (
  event.dataTransfer?.types.includes('Files') ?? false
);

const hasExternalText = (event: DragEvent): boolean => {
  const types = Array.from(event.dataTransfer?.types ?? []);
  return types.some((type) => type === 'text/plain' || type === 'text/uri-list')
    && types.every((type) => EXTERNAL_TEXT_TYPES.has(type));
};

/** What a text drag should become: a web node for a link, else a text node. */
export const readTextDrop = (
  transfer: Pick<DataTransfer, 'getData'>,
): { kind: 'url'; url: string } | { kind: 'text'; text: string } | null => {
  // RFC 2483: one URI per line; lines starting with `#` are comments.
  const uri = transfer.getData('text/uri-list')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith('#'));
  const fromList = uri ? normalizeReferenceUrl(uri) : undefined;
  if (fromList) return { kind: 'url', url: fromList };

  const text = transfer.getData('text/plain').trim();
  if (!text) return null;
  // Same rule as paste: plain prose must fail the omnibox check first.
  const url = looksLikeUrl(text) ? normalizeReferenceUrl(text) : undefined;
  return url ? { kind: 'url', url } : { kind: 'text', text };
};

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
 * A dragged link becomes a web node and dragged text a text node.
 */
export const useCanvasFileDrop = ({
  canvasId,
  containerRef,
  loaded,
  screenToCanvas,
  addNode,
  nodesRef,
  setSelectedNodeIds,
  createUrlNode,
}: Options) => {
  const { notify, updateToast } = useAppShell();
  const { t } = useI18n();

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const clearHighlight = () => container.classList.remove(DROP_TARGET_CLASS);
    const over = (event: DragEvent) => {
      if (!hasFiles(event) && !hasExternalText(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      container.classList.add(DROP_TARGET_CLASS);
    };
    const leave = (event: DragEvent) => {
      const next = event.relatedTarget;
      if (next instanceof Node && container.contains(next)) return;
      clearHighlight();
    };

    const dropText = (event: DragEvent) => {
      // A note or text editor under the pointer already took the text.
      if (event.defaultPrevented) return;
      const dropped = event.dataTransfer ? readTextDrop(event.dataTransfer) : null;
      if (!dropped) return;
      event.preventDefault();
      event.stopPropagation();
      clearHighlight();

      const at = screenToCanvas(event.clientX, event.clientY, container);
      if (dropped.kind === 'url' && createUrlNode) {
        const size = getNodeDefaultSize('iframe');
        const slot = findFreeSlot(
          nodesRef.current,
          at.x - size.width / 2,
          at.y - size.height / 2,
          size.width,
          size.height,
        );
        createUrlNode(dropped.url, { at: { x: slot.x + size.width / 2, y: slot.y + size.height / 2 } });
        return;
      }
      const text = dropped.kind === 'url' ? dropped.url : dropped.text;
      const patch = createTextPatch(text);
      const slot = findFreeSlot(
        nodesRef.current,
        at.x - patch.width / 2,
        at.y - patch.height / 2,
        patch.width,
        patch.height,
      );
      const node = addNode('text', slot.x, slot.y, { nodePatch: patch });
      setSelectedNodeIds([node.id]);
    };

    const drop = (event: DragEvent) => {
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length === 0) {
        if (hasExternalText(event)) dropText(event);
        return;
      }
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

      // Saving large images takes a moment each; show how far along it is.
      const totalBytes = supported.reduce((sum, file) => sum + file.size, 0);
      const showProgress = supported.length >= PROGRESS_MIN_FILES || totalBytes >= PROGRESS_MIN_BYTES;
      const progressId = showProgress
        ? notify({
            tone: 'loading',
            title: t('canvas.fileDropProgress', { done: 0, total: supported.length }),
          })
        : null;

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
          if (progressId) {
            updateToast(progressId, {
              title: t('canvas.fileDropProgress', { done: index + 1, total: supported.length }),
            });
          }
        }
        if (progressId) {
          updateToast(progressId, {
            tone: 'success',
            title: t('canvas.fileDropProgressDone', { count: created.length }),
            autoCloseMs: 2000,
          });
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
  }, [
    addNode,
    canvasId,
    containerRef,
    createUrlNode,
    loaded,
    nodesRef,
    notify,
    screenToCanvas,
    setSelectedNodeIds,
    t,
    updateToast,
  ]);
};
