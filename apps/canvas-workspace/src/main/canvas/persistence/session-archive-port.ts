import type { WorkspaceBundle, WorkspaceBundleImport } from '@pulse-coder/storage';
import type { WorkspaceExportFile } from '../workspace-export-archive';

export interface PreparedCanvasSessionImport {
  files: WorkspaceExportFile[];
  currentSessionId: string | null;
  conversations: NonNullable<WorkspaceBundleImport['conversations']>;
}

/** The composition root injects Agent codecs; Canvas never imports their implementation. */
export interface CanvasSessionArchivePort {
  assertWorkspaceStorage(root: string): Promise<void>;
  exportFiles(bundle: WorkspaceBundle): WorkspaceExportFile[];
  prepareImport(workspaceId: string, files: WorkspaceExportFile[], restoreManagedPath: (path: string) => string): PreparedCanvasSessionImport;
  rewriteAttachmentPaths(files: WorkspaceExportFile[], mapper: (path: string) => string): WorkspaceExportFile[];
  attachmentPaths(files: WorkspaceExportFile[]): string[];
}

type CanvasSessionArchiveLoader = () => Promise<CanvasSessionArchivePort>;
let archivePort: CanvasSessionArchivePort | CanvasSessionArchiveLoader | null = null;
let pendingPort: Promise<CanvasSessionArchivePort> | null = null;

/** Register a codec loader without loading or constructing it during app startup. */
export function setCanvasSessionArchivePort(port: CanvasSessionArchivePort | CanvasSessionArchiveLoader | null): void {
  archivePort = port;
  pendingPort = null;
}

export async function getCanvasSessionArchivePort(): Promise<CanvasSessionArchivePort> {
  if (!archivePort) throw new Error('Workspace conversation archive integration is unavailable');
  if (typeof archivePort !== 'function') return archivePort;
  if (!pendingPort) {
    const loading = Promise.resolve().then(archivePort);
    pendingPort = loading;
    void loading.catch(() => { if (pendingPort === loading) pendingPort = null; });
  }
  return pendingPort;
}

export function isWorkspaceSessionFile(path: string): boolean {
  return /^agent-sessions\/(?:current\.json|metadata\.json|archive\/[^/]+\.json)$/.test(path.replace(/\\/g, '/'));
}

/** Superseded JSON and its backups must never shadow a generated SQL snapshot. */
export function isLegacyWorkspaceSessionState(path: string): boolean {
  return /^agent-sessions\/(?:current\.json|metadata\.json|archive\/[^/]+\.json)(?:\..*)?$/.test(path.replace(/\\/g, '/'));
}
