export type StorageErrorCode =
  | 'invalid_argument'
  | 'not_found'
  | 'revision_conflict'
  | 'storage_busy'
  | 'storage_closed'
  | 'storage_unavailable'
  | 'unsupported_schema'
  | 'corrupt_data'
  | 'file_write_pending'
  | 'file_write_conflict';

export class StorageError extends Error {
  readonly code: StorageErrorCode;

  constructor(code: StorageErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'StorageError';
    this.code = code;
  }
}

/** Bundled CJS/ESM entrypoints may contain different class instances. Codes are the contract. */
export function isStorageError(error: unknown): error is StorageError {
  if (!(error instanceof Error) || !('code' in error)) return false;
  return [
    'invalid_argument', 'not_found', 'revision_conflict', 'storage_busy',
    'storage_closed', 'storage_unavailable', 'unsupported_schema', 'corrupt_data',
    'file_write_pending', 'file_write_conflict',
  ].includes(String(error.code));
}

export class RevisionConflictError extends StorageError {
  constructor(
    readonly resourceId: string,
    readonly expectedRevision: number | null,
    readonly actualRevision: number | null,
  ) {
    super(
      'revision_conflict',
      `Revision conflict for "${resourceId}": expected ${expectedRevision}, found ${actualRevision}`,
    );
    this.name = 'RevisionConflictError';
  }
}
