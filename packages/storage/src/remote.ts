import type {
  CanvasCommit,
  CanvasRepository,
  CanvasSnapshot,
  ChangeRepository,
  CommitReceipt,
  ConversationCommit,
  ConversationRepository,
  ConversationSnapshot,
  EntityRecord,
  JsonObject,
  Page,
  PageRequest,
  PulseStorage,
  StorageChange,
  StorageIntegrity,
} from './contracts.js';
import type {
  ConversationScopeCommit,
  ConversationScopeRepository,
  ConversationScopeSnapshot,
} from './conversation-scopes.js';
import { StorageError, type StorageErrorCode } from './errors.js';
import type {
  FileWriteListRequest,
  FileWriteRecord,
  FileWriteRepository,
  FileWriteResolution,
  FileWriteSettlement,
} from './file-contracts.js';
import type {
  TrashWorkspaceInput,
  WorkspaceBundle,
  WorkspaceBundleImport,
  WorkspaceBundleReceipt,
  WorkspaceConversationState,
  WorkspaceRepository,
  WorkspaceTrashRecord,
} from './workspace-contracts.js';
import type {
  FileBytes,
  FileContentVersion,
  FileText,
  FileWriteOptions,
  FileWriteReceipt,
  WorkspaceFiles,
} from './workspace-files.js';

export interface RemoteStorageOptions {
  /** Base HTTP URL of the remote daemon, e.g. `http://127.0.0.1:4770`. */
  endpoint: string;
  /** Bearer token for authenticating `/v1/*` requests. */
  token: string;
  /** Optional custom fetch implementation (useful for tests or proxying). */
  fetch?: typeof globalThis.fetch;
  /** Request timeout in milliseconds (default: 30_000). */
  timeoutMs?: number;
}

export interface StorageRpcRequest {
  method: string;
  args: unknown[];
}

export interface StorageRpcErrorBody {
  ok: false;
  code: StorageErrorCode;
  message: string;
}

export interface StorageRpcSuccessBody<T = unknown> {
  ok: true;
  result: T;
}

export type StorageRpcResponse<T = unknown> = StorageRpcSuccessBody<T> | StorageRpcErrorBody;

export interface RemoteMetaResponse {
  ok: true;
  generation: string;
  version: string;
  capabilities: string[];
}

const VALID_ERROR_CODES = new Set<string>([
  'invalid_argument',
  'not_found',
  'revision_conflict',
  'storage_busy',
  'storage_closed',
  'storage_unavailable',
  'unsupported_schema',
  'corrupt_data',
  'file_write_pending',
  'file_write_conflict',
]);

function normalizeEndpoint(endpoint: string): string {
  const trimmed = endpoint.trim().replace(/\/+$/, '');
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
    throw new StorageError(
      'invalid_argument',
      `Remote storage endpoint must be http(s): ${endpoint}`,
    );
  }
  return trimmed;
}

function toStorageErrorCode(code: unknown): StorageErrorCode {
  return typeof code === 'string' && VALID_ERROR_CODES.has(code)
    ? (code as StorageErrorCode)
    : 'storage_unavailable';
}

function createRequester(options: RemoteStorageOptions) {
  const baseUrl = normalizeEndpoint(options.endpoint);
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const authHeaders = { Authorization: `Bearer ${options.token}` };

  async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${baseUrl}${path}`, {
        ...init,
        headers: { ...authHeaders, ...(init?.headers ?? {}) },
        signal: controller.signal,
      });
      const text = await response.text();
      let parsed: unknown;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        throw new StorageError(
          'storage_unavailable',
          `Remote storage returned non-JSON response (${response.status})`,
        );
      }
      if (
        !response.ok ||
        (parsed && typeof parsed === 'object' && (parsed as { ok?: boolean }).ok === false)
      ) {
        const errObj = parsed as Partial<StorageRpcErrorBody> | null;
        // Trust the daemon's own code; the status only covers bodies without
        // one (for example an older daemon or a proxy error page).
        const code =
          typeof errObj?.code === 'string' && VALID_ERROR_CODES.has(errObj.code)
            ? (errObj.code as StorageErrorCode)
            : response.status === 404
              ? 'not_found'
              : response.status === 409
                ? 'revision_conflict'
                : toStorageErrorCode(errObj?.code);
        throw new StorageError(
          code,
          errObj?.message || `Remote storage request failed (${response.status})`,
        );
      }
      return parsed as T;
    } catch (error) {
      if (error instanceof StorageError) throw error;
      const detail = error instanceof Error ? error.message : String(error);
      throw new StorageError('storage_unavailable', `Remote storage request error: ${detail}`, {
        cause: error,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async function rpc<T>(method: string, ...args: unknown[]): Promise<T> {
    const body = await requestJson<StorageRpcSuccessBody<T>>('/v1/storage/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method, args } satisfies StorageRpcRequest),
    });
    return body.result;
  }

  return { baseUrl, fetchImpl, authHeaders, requestJson, rpc };
}

/**
 * Open a remote PulseStorage client backed by a pulse-vps-daemon HTTP endpoint.
 * Fetches `/v1/meta` eagerly to verify connectivity, auth, and store generation.
 */
export async function openRemoteStorage(options: RemoteStorageOptions): Promise<PulseStorage> {
  const { requestJson, rpc } = createRequester(options);
  let closed = false;
  const meta = await requestJson<RemoteMetaResponse>('/v1/meta', { method: 'GET' });

  const ensureOpen = () => {
    if (closed) throw new StorageError('storage_closed', 'Remote storage connection is closed');
  };

  const call = <T>(method: string, ...args: unknown[]): Promise<T> => {
    ensureOpen();
    return rpc<T>(method, ...args);
  };

  const canvas: CanvasRepository = {
    read: (workspaceId: string) => call<CanvasSnapshot | null>('canvas.read', workspaceId),
    list: (request?: PageRequest) =>
      call<Page<{ workspaceId: string; revision: number; metadata: JsonObject }>>(
        'canvas.list',
        request,
      ),
    readNode: (workspaceId: string, nodeId: string) =>
      call<EntityRecord | null>('canvas.readNode', workspaceId, nodeId),
    listNodes: (workspaceId: string, request?: PageRequest) =>
      call<Page<EntityRecord>>('canvas.listNodes', workspaceId, request),
    commit: (input: CanvasCommit) => call<CommitReceipt>('canvas.commit', input),
    remove: (workspaceId: string, expectedRevision: number) =>
      call<CommitReceipt>('canvas.remove', workspaceId, expectedRevision),
  };

  const workspaces: WorkspaceRepository = {
    readBundle: (workspaceId: string) =>
      call<WorkspaceBundle | null>('workspaces.readBundle', workspaceId),
    importBundle: (input: WorkspaceBundleImport) =>
      call<WorkspaceBundleReceipt>('workspaces.importBundle', input),
    trashBundle: (input: TrashWorkspaceInput) =>
      call<WorkspaceTrashRecord>('workspaces.trashBundle', input),
    getTrashed: (workspaceId: string) =>
      call<WorkspaceTrashRecord | null>('workspaces.getTrashed', workspaceId),
    listTrashed: (request?: PageRequest) =>
      call<Page<WorkspaceTrashRecord>>('workspaces.listTrashed', request),
    restoreBundle: (workspaceId: string, expectedRevision: number, generation: string) =>
      call<CommitReceipt>('workspaces.restoreBundle', workspaceId, expectedRevision, generation),
    removeBundle: (
      workspaceId: string,
      expectedCanvasRevision: number,
      generation: string,
      expectedConversations?: WorkspaceConversationState,
    ) =>
      call<CommitReceipt>(
        'workspaces.removeBundle',
        workspaceId,
        expectedCanvasRevision,
        generation,
        expectedConversations,
      ),
  };

  const conversations: ConversationRepository = {
    read: (scopeId: string, sessionId: string) =>
      call<ConversationSnapshot | null>('conversations.read', scopeId, sessionId),
    list: (scopeId: string, request?: PageRequest) =>
      call<Page<Omit<ConversationSnapshot, 'messages'>>>('conversations.list', scopeId, request),
    commit: (input: ConversationCommit) => call<CommitReceipt>('conversations.commit', input),
    remove: (scopeId: string, sessionId: string, expectedRevision: number) =>
      call<CommitReceipt>('conversations.remove', scopeId, sessionId, expectedRevision),
  };

  const conversationScopes: ConversationScopeRepository = {
    read: (scopeId: string) =>
      call<ConversationScopeSnapshot | null>('conversationScopes.read', scopeId),
    list: (request?: PageRequest) =>
      call<Page<ConversationScopeSnapshot>>('conversationScopes.list', request),
    commit: (input: ConversationScopeCommit) =>
      call<CommitReceipt>('conversationScopes.commit', input),
  };

  const fileWrites: FileWriteRepository = {
    get: (id: string) => call<FileWriteRecord | null>('fileWrites.get', id),
    list: (request?: FileWriteListRequest) =>
      call<Page<FileWriteRecord>>('fileWrites.list', request),
    settle: (id: string, outcome: FileWriteSettlement) =>
      call<FileWriteResolution>('fileWrites.settle', id, outcome),
  };

  const changes: ChangeRepository = {
    read: (request?: PageRequest) => call<Page<StorageChange>>('changes.read', request),
    latestCursor: () => call<string>('changes.latestCursor'),
  };

  return {
    generation: meta.generation,
    canvas,
    workspaces,
    conversations,
    conversationScopes,
    fileWrites,
    changes,
    backup: (destination: string) => call<void>('backup', destination),
    checkIntegrity: () => call<StorageIntegrity>('checkIntegrity'),
    close: async () => {
      closed = true;
    },
  };
}

const REMOTE_URI_PREFIX = 'pulse-remote://';

/**
 * Remote WorkspaceFiles adapter backed by the VPS daemon's `/v1/files` endpoints.
 * Files are addressed via `pulse-remote://<posix-path>` URIs and versioned by `sha256:`.
 */
export function createRemoteWorkspaceFiles(options: RemoteStorageOptions): WorkspaceFiles {
  const { requestJson } = createRequester(options);

  const encodeUriParam = (uri: string) => encodeURIComponent(uri);

  return {
    uriForPath(path: string): string {
      if (path.startsWith(REMOTE_URI_PREFIX)) return path;
      const normalized = path.replace(/\\/g, '/').replace(/^\/+/, '');
      return `${REMOTE_URI_PREFIX}/${normalized}`;
    },

    localPath(uri: string): string {
      if (!uri.startsWith(REMOTE_URI_PREFIX)) {
        throw new StorageError('invalid_argument', `Not a remote workspace file URI: ${uri}`);
      }
      return uri.slice(REMOTE_URI_PREFIX.length);
    },

    async readBytes(uri: string): Promise<FileBytes | null> {
      try {
        const res = await requestJson<{
          ok: true;
          uri: string;
          version: FileContentVersion;
          base64: string;
        }>(`/v1/files?uri=${encodeUriParam(uri)}`, { method: 'GET' });
        return {
          uri: res.uri,
          version: res.version,
          bytes: Buffer.from(res.base64, 'base64'),
        };
      } catch (error) {
        if (error instanceof StorageError && error.code === 'not_found') return null;
        throw error;
      }
    },

    async readText(uri: string): Promise<FileText | null> {
      const file = await this.readBytes(uri);
      if (!file) return null;
      return {
        uri: file.uri,
        version: file.version,
        content: new TextDecoder('utf-8').decode(file.bytes),
      };
    },

    async write(
      uri: string,
      content: string | Uint8Array,
      writeOptions?: FileWriteOptions,
    ): Promise<FileWriteReceipt> {
      const bytes =
        typeof content === 'string' ? Buffer.from(content, 'utf8') : Buffer.from(content);
      const res = await requestJson<{ ok: true; uri: string; version: FileContentVersion }>(
        `/v1/files?uri=${encodeUriParam(uri)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            base64: bytes.toString('base64'),
            ...(writeOptions && 'expectedVersion' in writeOptions
              ? { expectedVersion: writeOptions.expectedVersion }
              : {}),
          }),
        },
      );
      return { uri: res.uri, version: res.version };
    },

    async remove(
      uri: string,
      removeOptions?: { expectedVersion?: FileContentVersion },
    ): Promise<void> {
      const query = new URLSearchParams({ uri });
      if (removeOptions?.expectedVersion) {
        query.set('expectedVersion', removeOptions.expectedVersion);
      }
      await requestJson<{ ok: true }>(`/v1/files?${query.toString()}`, { method: 'DELETE' });
    },

    watchDirectory(_uri: string, _onChange: () => void, _onError?: () => void): () => void {
      // Remote change delivery flows through subscribeRemoteChanges (/v1/events).
      return () => undefined;
    },
  };
}

export interface RemoteChangeSubscriptionOptions extends RemoteStorageOptions {
  /** Resume from this cursor if known. */
  cursor?: string;
  /** Filter changes to a single workspace/scope id. */
  scopeId?: string;
  /** Reconnect delay on transient network drops (default: 2000ms). */
  reconnectDelayMs?: number;
}

/**
 * Subscribe to real-time `StorageChange` events streamed from `/v1/events` (SSE).
 * Reconnects automatically with the latest seen cursor until the returned stop function runs.
 */
export function subscribeRemoteChanges(
  options: RemoteChangeSubscriptionOptions,
  onChange: (change: StorageChange) => void,
  onError?: (error: Error) => void,
): () => void {
  const { baseUrl, fetchImpl, authHeaders } = createRequester(options);
  const reconnectDelayMs = options.reconnectDelayMs ?? 2_000;
  let stopped = false;
  let lastCursor = options.cursor;
  let activeController: AbortController | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const scheduleReconnect = () => {
    if (stopped) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void connect();
    }, reconnectDelayMs);
  };

  const connect = async () => {
    if (stopped) return;
    const controller = new AbortController();
    activeController = controller;
    const query = new URLSearchParams();
    if (lastCursor) query.set('cursor', lastCursor);
    if (options.scopeId) query.set('scopeId', options.scopeId);
    const qs = query.toString();

    try {
      const response = await fetchImpl(`${baseUrl}/v1/events${qs ? `?${qs}` : ''}`, {
        method: 'GET',
        headers: { ...authHeaders, Accept: 'text/event-stream' },
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        throw new Error(`SSE /v1/events failed with status ${response.status}`);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (!stopped) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let boundary = buffer.indexOf('\n\n');
        while (boundary >= 0) {
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          for (const line of block.split('\n')) {
            if (!line.startsWith('data:')) continue;
            const payload = line.slice(5).trim();
            if (!payload) continue;
            try {
              const change = JSON.parse(payload) as StorageChange;
              if (change.cursor) lastCursor = change.cursor;
              onChange(change);
            } catch {
              // Ignore malformed keepalive or partial comment frames.
            }
          }
          boundary = buffer.indexOf('\n\n');
        }
      }
    } catch (error) {
      if (!stopped) {
        onError?.(error instanceof Error ? error : new Error(String(error)));
      }
    } finally {
      if (activeController === controller) activeController = null;
      scheduleReconnect();
    }
  };

  void connect();

  return () => {
    stopped = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    activeController?.abort();
  };
}
