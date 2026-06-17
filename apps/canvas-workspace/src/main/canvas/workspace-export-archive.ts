import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

const EXPORT_FORMAT = 'pulse-canvas-workspace';
const EXPORT_VERSION = 1;
const EXPORT_PAYLOAD_FILENAME = 'workspace.json';

export interface WorkspaceExportFile {
  relativePath: string;
  encoding: 'base64';
  content: string;
}

export interface WorkspaceExportPayload {
  format: typeof EXPORT_FORMAT;
  version: typeof EXPORT_VERSION;
  exportedAt: string;
  workspace: {
    id: string;
    name: string;
  };
  canvas: unknown;
  files: WorkspaceExportFile[];
}

export const createWorkspaceExportPayload = (payload: Omit<WorkspaceExportPayload, 'format' | 'version'>): WorkspaceExportPayload => ({
  format: EXPORT_FORMAT,
  version: EXPORT_VERSION,
  ...payload,
});

export const isSafeRelativePath = (relativePath: string): boolean => {
  if (!relativePath || relativePath.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(relativePath)) return false;
  const normalized = relativePath.replace(/\\/g, '/');
  return !normalized.split('/').some((part) => part === '..' || part === '');
};

const parseWorkspaceExportPayload = (raw: string): WorkspaceExportPayload => {
  const parsed = JSON.parse(raw) as Partial<WorkspaceExportPayload>;
  if (parsed.format !== EXPORT_FORMAT) {
    throw new Error('Selected file is not a Pulse Canvas workspace export.');
  }
  if (parsed.version !== EXPORT_VERSION) {
    throw new Error(`Unsupported Pulse Canvas export version: ${String(parsed.version)}`);
  }
  if (!parsed.workspace || typeof parsed.workspace.name !== 'string') {
    throw new Error('Workspace export is missing workspace metadata.');
  }
  if (!Array.isArray(parsed.files)) {
    throw new Error('Workspace export is missing file payloads.');
  }
  for (const file of parsed.files) {
    if (!file || typeof file.relativePath !== 'string' || file.encoding !== 'base64' || typeof file.content !== 'string') {
      throw new Error('Workspace export contains an invalid file entry.');
    }
    if (!isSafeRelativePath(file.relativePath)) {
      throw new Error(`Workspace export contains an unsafe file path: ${file.relativePath}`);
    }
  }
  return parsed as WorkspaceExportPayload;
};

const isZipArchive = (bytes: Uint8Array): boolean =>
  bytes.length >= 4 &&
  bytes[0] === 0x50 &&
  bytes[1] === 0x4b &&
  (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07) &&
  (bytes[3] === 0x04 || bytes[3] === 0x06 || bytes[3] === 0x08);

export const createWorkspaceExportArchive = (payload: WorkspaceExportPayload): Buffer => {
  const serialized = JSON.stringify(payload, null, 2);
  const zipped = zipSync({
    [EXPORT_PAYLOAD_FILENAME]: strToU8(serialized),
  }, { level: 6 });
  return Buffer.from(zipped);
};

export const parseWorkspaceExportFile = (bytes: Uint8Array): WorkspaceExportPayload => {
  if (!isZipArchive(bytes)) {
    return parseWorkspaceExportPayload(Buffer.from(bytes).toString('utf-8'));
  }

  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch (err) {
    throw new Error(`Failed to read Pulse Canvas workspace archive: ${err instanceof Error ? err.message : String(err)}`);
  }

  const payloadBytes = entries[EXPORT_PAYLOAD_FILENAME];
  if (!payloadBytes) {
    throw new Error(`Pulse Canvas workspace archive is missing ${EXPORT_PAYLOAD_FILENAME}.`);
  }
  return parseWorkspaceExportPayload(strFromU8(payloadBytes));
};
