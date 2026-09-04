import type { ChatImageAttachment } from '../../../types';

export const CHAT_ATTACHMENT_LIMITS = {
  count: 6,
  perFileBytes: 12 * 1024 * 1024,
  totalBytes: 30 * 1024 * 1024,
} as const;

const MAX_RETAINED_SCOPES = 32;

interface Reservation {
  sizeBytes: number;
  observed: boolean;
  countsTowardLimits: boolean;
}

interface UploadToken {
  cancelled: boolean;
}

interface ScopeRuntime {
  reservations: Map<string, Reservation>;
  retryFiles: Map<string, File>;
  removedIds: Set<string>;
  uploadTokens: Map<string, UploadToken>;
  uploadTail: Promise<void>;
  touchedAt: number;
}

export interface AttachmentFileReservation {
  id: string;
  file: File;
  exceedsCountLimit: boolean;
  exceedsFileLimit: boolean;
  exceedsTotalLimit: boolean;
  accepted: boolean;
}

const runtimes = new Map<string, ScopeRuntime>();
let touchSequence = 0;

const touch = (runtime: ScopeRuntime): void => {
  runtime.touchedAt = ++touchSequence;
};

const pruneRuntimes = (protectedScopeId?: string): void => {
  if (runtimes.size <= MAX_RETAINED_SCOPES) return;
  const evictable = [...runtimes.entries()]
    .filter(([scopeId, runtime]) => (
      scopeId !== protectedScopeId && runtime.uploadTokens.size === 0
    ))
    .sort((left, right) => left[1].touchedAt - right[1].touchedAt);
  for (const [scopeId] of evictable) {
    if (runtimes.size <= MAX_RETAINED_SCOPES) break;
    runtimes.delete(scopeId);
  }
};

const getRuntime = (scopeId: string): ScopeRuntime => {
  const existing = runtimes.get(scopeId);
  if (existing) {
    touch(existing);
    return existing;
  }
  const runtime: ScopeRuntime = {
    reservations: new Map(),
    retryFiles: new Map(),
    removedIds: new Set(),
    uploadTokens: new Map(),
    uploadTail: Promise.resolve(),
    touchedAt: 0,
  };
  touch(runtime);
  runtimes.set(scopeId, runtime);
  pruneRuntimes(scopeId);
  return runtime;
};

const cancelToken = (runtime: ScopeRuntime, id: string): void => {
  const token = runtime.uploadTokens.get(id);
  if (token) token.cancelled = true;
  runtime.uploadTokens.delete(id);
};

/**
 * Reconciles durable composer state without discarding reservations that React
 * has not rendered yet. That unobserved window is what makes rapid calls atomic.
 */
export const reconcileAttachmentRuntime = (
  scopeId: string,
  attachments: ChatImageAttachment[],
): void => {
  const runtime = getRuntime(scopeId);
  const currentIds = new Set(attachments.map(attachment => attachment.id));
  for (const id of runtime.removedIds) {
    if (!currentIds.has(id)) runtime.removedIds.delete(id);
  }
  for (const [id, reservation] of runtime.reservations) {
    if (runtime.removedIds.has(id)) {
      runtime.reservations.delete(id);
    } else if (currentIds.has(id)) {
      reservation.observed = true;
    } else if (reservation.observed) {
      cancelToken(runtime, id);
      runtime.retryFiles.delete(id);
      runtime.reservations.delete(id);
    }
  }
  for (const attachment of attachments) {
    if (runtime.removedIds.has(attachment.id)) continue;
    const countsTowardLimits = attachment.status !== 'failed' || attachment.retryable !== false;
    const reservation = runtime.reservations.get(attachment.id);
    if (reservation) {
      reservation.sizeBytes = attachment.sizeBytes ?? 0;
      reservation.observed = true;
      reservation.countsTowardLimits = countsTowardLimits;
    } else {
      runtime.reservations.set(attachment.id, {
        sizeBytes: attachment.sizeBytes ?? 0,
        observed: true,
        countsTowardLimits,
      });
    }
  }
};

export const reserveAttachmentFiles = (
  scopeId: string,
  attachments: ChatImageAttachment[],
  files: File[],
  createId: (index: number) => string,
): AttachmentFileReservation[] => {
  reconcileAttachmentRuntime(scopeId, attachments);
  const runtime = getRuntime(scopeId);
  let totalBytes = [...runtime.reservations.values()]
    .filter(reservation => reservation.countsTowardLimits)
    .reduce((total, reservation) => total + reservation.sizeBytes, 0);
  let acceptedCount = [...runtime.reservations.values()]
    .filter(reservation => reservation.countsTowardLimits).length;

  return files.map((file, index) => {
    const id = createId(index);
    const exceedsCountLimit = acceptedCount >= CHAT_ATTACHMENT_LIMITS.count;
    const exceedsFileLimit = file.size > CHAT_ATTACHMENT_LIMITS.perFileBytes;
    const exceedsTotalLimit = totalBytes + file.size > CHAT_ATTACHMENT_LIMITS.totalBytes;
    const accepted = !exceedsCountLimit && !exceedsFileLimit && !exceedsTotalLimit;
    runtime.reservations.set(id, {
      sizeBytes: file.size,
      observed: false,
      countsTowardLimits: accepted,
    });
    if (accepted) {
      totalBytes += file.size;
      acceptedCount += 1;
      runtime.retryFiles.set(id, file);
    }
    return {
      id,
      file,
      exceedsCountLimit,
      exceedsFileLimit,
      exceedsTotalLimit,
      accepted,
    };
  });
};

export const getAttachmentRetryFile = (scopeId: string, id: string): File | undefined => {
  const runtime = getRuntime(scopeId);
  return runtime.retryFiles.get(id);
};

export const forgetAttachmentRetryFile = (scopeId: string, id: string): void => {
  const runtime = getRuntime(scopeId);
  runtime.retryFiles.delete(id);
};

export const cancelAttachmentWork = (scopeId: string, id: string): void => {
  const runtime = getRuntime(scopeId);
  cancelToken(runtime, id);
  runtime.retryFiles.delete(id);
  runtime.reservations.delete(id);
  runtime.removedIds.add(id);
};

export const enqueueAttachmentUpload = (
  scopeId: string,
  id: string,
  run: (file: File, isCancelled: () => boolean) => Promise<void>,
): void => {
  const runtime = getRuntime(scopeId);
  cancelToken(runtime, id);
  const token: UploadToken = { cancelled: false };
  runtime.uploadTokens.set(id, token);
  const isCancelled = () => (
    token.cancelled
    || runtime.uploadTokens.get(id) !== token
    || !runtime.retryFiles.has(id)
  );

  runtime.uploadTail = runtime.uploadTail
    .catch(() => undefined)
    .then(async () => {
      const file = runtime.retryFiles.get(id);
      if (!file || isCancelled()) return;
      await run(file, isCancelled);
    })
    .catch(() => undefined)
    .finally(() => {
      if (runtime.uploadTokens.get(id) === token) runtime.uploadTokens.delete(id);
      touch(runtime);
      pruneRuntimes();
    });
};

/** Test-only reset; production runtimes intentionally survive surface remounts. */
export const resetChatAttachmentRuntimesForTests = (): void => {
  for (const runtime of runtimes.values()) {
    for (const token of runtime.uploadTokens.values()) token.cancelled = true;
  }
  runtimes.clear();
  touchSequence = 0;
};
