export { createCanvasMemoryTools, type CanvasMemoryToolDeps } from './tools';
export {
  ensureCanvasMemory,
  getCanvasMemoryService,
  canvasMemoryBaseDir,
  __setCanvasMemoryServiceForTest,
} from './canvas-memory-service';
export {
  memoryKeysForScope,
  CANVAS_GLOBAL_MEMORY_KEY,
  CANVAS_BUCKET_SESSION_ID,
  type CanvasMemoryKeys,
} from './keys';
export {
  sedimentTurn,
  recordWorkspaceMemory,
  promoteToGlobalMemory,
  recallMemory,
} from './canvas-memory';
export {
  type MemoryGranularity,
  type MemoryOrigin,
  type RecalledMemory,
} from './ranking';
