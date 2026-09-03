export {
  CanvasDocumentHistory,
  type CanvasDocumentSnapshot,
} from './document/CanvasDocumentHistory';
export { useCanvasDocumentHistory } from './document/useCanvasDocumentHistory';
export {
  useCanvasDocument,
  type AddNodeOptions,
} from './document/useCanvasDocument';
export {
  mergeExternalDocumentUpdate,
  shouldReloadForExternalUpdate,
  type ExternalDocumentMergeResult,
  type ExternalDocumentUpdate,
  type ExternalDocumentUpdateEvent,
} from './document/externalMerge';
