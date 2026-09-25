import { createHash } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import type { JsonObject, WorkspaceBundle } from '@pulse-coder/storage';
import type { WorkspaceExportFile } from '../canvas/workspace-export-archive';
import {
  isWorkspaceSessionFile, setCanvasSessionArchivePort,
  type CanvasSessionArchivePort, type PreparedCanvasSessionImport,
} from '../canvas/persistence/session-archive-port';
import { decodeSession, encodeSessionMessages, encodeSessionMetadata, readLegacySessionDisplayMetadata, validateLegacySession } from './sqlite-session-codec';
import { sessionUpdatedAt } from './session-file-summary';
import type { CanvasAgentSession } from './types';
import { sessionStorageRoot } from './sqlite-session-backend';
import { withWorkspaceTrashGuard } from './workspace-runtime-guard';

const normalized = (path: string) => path.replace(/\\/g, '/');
const isSessionBody = (path: string) => isWorkspaceSessionFile(path) && !normalized(path).endsWith('/metadata.json');

async function assertWorkspaceStorage(root: string): Promise<void> {
  const canvasRoot = resolve(root);
  const sessionRoot = resolve(sessionStorageRoot());
  if (canvasRoot === sessionRoot) return;
  try {
    const roots = await Promise.all([realpath(canvasRoot), realpath(sessionRoot)]);
    if (roots[0] === roots[1]) return;
    const databases = await Promise.all(roots.map(path => realpath(join(path, '__storage__.sqlite'))));
    if (databases[0] === databases[1]) return;
  } catch {
    // An absent or inaccessible path cannot prove the archive will include both stores.
  }
  throw new Error('Full workspace import/export requires Canvas and conversations to share the same database; '
    + 'this profile uses a separate conversation storage root.');
}

function value(file: WorkspaceExportFile): unknown {
  try { return JSON.parse(Buffer.from(file.content, 'base64').toString('utf8')); }
  catch { throw new Error(`Invalid conversation archive JSON: ${file.relativePath}`); }
}

function encodedFile(relativePath: string, payload: unknown): WorkspaceExportFile {
  return { relativePath, encoding: 'base64', content: Buffer.from(JSON.stringify(payload, null, 2)).toString('base64') };
}

function rewriteAttachments(session: CanvasAgentSession, mapper: (path: string) => string): CanvasAgentSession {
  return {
    ...session,
    messages: session.messages.map(message => ({
      ...message,
      ...(message.attachments ? { attachments: message.attachments.map(attachment => ({
        ...attachment, path: mapper(attachment.path),
      })) } : {}),
    })),
  };
}

function exportFiles(bundle: WorkspaceBundle): WorkspaceExportFile[] {
  if (!bundle.conversationScope && !bundle.conversations.length) return [];
  const files: WorkspaceExportFile[] = [];
  const metadata: Array<[string, JsonObject]> = [];
  const index: Array<[string, JsonObject]> = [];
  for (const record of bundle.conversations) {
    const session = validateLegacySession(decodeSession(record), record.sessionId);
    const current = record.sessionId === bundle.conversationScope?.currentSessionId;
    const suffix = createHash('sha256').update(record.sessionId).digest('hex').slice(0, 24);
    const path = current ? 'current.json' : `archive/${session.startedAt.slice(0, 10)}-${suffix}.json`;
    const file = encodedFile(`agent-sessions/${path}`, session);
    files.push(file);
    const { session: _session, messageCount: _count, preview: _preview, date: _date,
      updatedAt: _updated, sortKey: _sort, archiveKeys: _keys, ...display } = record.metadata;
    metadata.push([record.sessionId, display]);
    index.push([path, {
      sessionId: record.sessionId,
      date: typeof record.metadata.date === 'string' ? record.metadata.date : session.startedAt.slice(0, 10),
      updatedAt: Number(record.metadata.updatedAt ?? sessionUpdatedAt(session)),
      messageCount: session.messages.length,
      preview: typeof record.metadata.preview === 'string' ? record.metadata.preview : '',
      mtimeMs: Number(record.metadata.sortKey ?? record.metadata.updatedAt ?? 0),
      size: Buffer.from(file.content, 'base64').length,
    }]);
  }
  if (bundle.conversationScope?.currentSessionId
    && !bundle.conversations.some(record => record.sessionId === bundle.conversationScope!.currentSessionId)) {
    throw new Error('The current conversation is missing from the workspace snapshot');
  }
  files.push(encodedFile('agent-sessions/metadata.json', {
    version: 2, sessions: Object.fromEntries(metadata), files: Object.fromEntries(index),
  }));
  return files;
}

function prepareImport(
  workspaceId: string,
  files: WorkspaceExportFile[],
  restoreManagedPath: (path: string) => string,
): PreparedCanvasSessionImport {
  const stateFiles = files.filter(file => isWorkspaceSessionFile(file.relativePath));
  const paths = new Set<string>();
  for (const file of stateFiles) {
    const path = normalized(file.relativePath);
    if (paths.has(path)) throw new Error(`Duplicate conversation archive file: ${path}`);
    paths.add(path);
  }
  const metadataFile = stateFiles.find(file => normalized(file.relativePath) === 'agent-sessions/metadata.json');
  const metadataValue = metadataFile ? value(metadataFile) : undefined;
  const display = readLegacySessionDisplayMetadata(metadataValue, 'agent-sessions/metadata.json');
  const indexed = metadataValue && typeof metadataValue === 'object' && 'files' in metadataValue
    ? metadataValue.files as Record<string, { mtimeMs?: unknown }> : undefined;
  const candidates = new Map<string, { session: CanvasAgentSession; current: boolean; score: number; archiveKeys: string[] }>();
  let currentSessionId: string | null = null;
  const orderedFiles = [...files].sort((left, right) => (
    Number(normalized(right.relativePath) === 'agent-sessions/current.json')
    - Number(normalized(left.relativePath) === 'agent-sessions/current.json')
  ));
  const rewritten = orderedFiles.map(file => {
    if (!isSessionBody(file.relativePath)) return file;
    const path = normalized(file.relativePath);
    const session = rewriteAttachments(validateLegacySession(value(file), path), restoreManagedPath);
    session.workspaceId = workspaceId;
    session.scope = { kind: 'workspace', workspaceId };
    const current = path === 'agent-sessions/current.json';
    if (current) currentSessionId = session.sessionId;
    const indexKey = path.slice('agent-sessions/'.length);
    const indexedTime = indexed?.[indexKey]?.mtimeMs;
    const score = typeof indexedTime === 'number' && Number.isFinite(indexedTime) ? indexedTime : sessionUpdatedAt(session);
    const previous = candidates.get(session.sessionId);
    const archiveKeys = [...(previous?.archiveKeys ?? []), ...(current ? [] : [indexKey.slice('archive/'.length, -'.json'.length)])];
    if (!previous || current || (!previous.current && score > previous.score)) {
      candidates.set(session.sessionId, { session, current, score, archiveKeys });
    } else {
      if (!previous.current && score === previous.score && !isDeepStrictEqual(previous.session, session)) {
        throw new Error(`Conflicting archived copies have no reliable newest version: ${session.sessionId}`);
      }
      previous.archiveKeys = archiveKeys;
    }
    return encodedFile(file.relativePath, session);
  });
  return {
    files: rewritten,
    currentSessionId,
    conversations: [...candidates.values()].map(candidate => ({
      sessionId: candidate.session.sessionId,
      metadata: encodeSessionMetadata(candidate.session, {}, {
        ...display[candidate.session.sessionId], archiveKeys: candidate.archiveKeys,
      }, candidate.score),
      messages: encodeSessionMessages(workspaceId, candidate.session.sessionId, candidate.session.messages, { migration: true }),
    })),
  };
}

export function createCanvasSessionArchivePort(): CanvasSessionArchivePort {
  return {
    assertWorkspaceStorage,
    withWorkspaceTrashGuard,
    exportFiles,
    prepareImport,
    rewriteAttachmentPaths: (files, mapper) => files.map(file => isSessionBody(file.relativePath)
      ? encodedFile(file.relativePath, rewriteAttachments(validateLegacySession(value(file), file.relativePath), mapper)) : file),
    attachmentPaths: files => files.filter(file => isSessionBody(file.relativePath)).flatMap(file => (
      validateLegacySession(value(file), file.relativePath).messages.flatMap(message =>
        (message.attachments ?? []).map(attachment => attachment.path),
      )
    )),
  };
}

/** Called by app/bootstrap, keeping the Canvas → Agent dependency out of both domains. */
export function initializeCanvasSessionArchivePort(): void {
  setCanvasSessionArchivePort(createCanvasSessionArchivePort());
}
