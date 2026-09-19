import { StorageError } from '../errors.js';

export function validateId(value: string, label = 'id'): void {
  if (typeof value !== 'string' || !value || value.length > 1024 || /[\u0000-\u001f]/.test(value)) {
    throw new StorageError('invalid_argument', `Invalid ${label}`);
  }
}

export function encodeJson(value: unknown): string {
  try {
    const encoded = JSON.stringify(value, (_key, item: unknown) => {
      if (typeof item === 'number' && !Number.isFinite(item)) throw new Error('Non-finite number');
      if (item === undefined || typeof item === 'function' || typeof item === 'symbol' || typeof item === 'bigint') {
        throw new Error('Value is not JSON');
      }
      return item;
    });
    if (encoded === undefined) throw new Error('Value is not JSON');
    return encoded;
  } catch (cause) {
    throw new StorageError('invalid_argument', 'Storage values must be JSON-serializable', { cause });
  }
}

export function decodeJson<T>(text: string): T {
  try { return JSON.parse(text) as T; }
  catch (cause) { throw new StorageError('corrupt_data', 'Invalid JSON in persistent storage', { cause }); }
}

export function pageLimit(limit?: number): number {
  if (limit === undefined) return 100;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
    throw new StorageError('invalid_argument', 'Page limit must be an integer from 1 to 500');
  }
  return limit;
}

export function encodeCursor(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

export function decodeCursor(cursor?: string): string | undefined {
  if (cursor === undefined) return undefined;
  try {
    if (!cursor || cursor.length > 8192 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error('Invalid encoding');
    const value = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(cursor, 'base64url'));
    if (encodeCursor(value) !== cursor) throw new Error('Non-canonical encoding');
    return value;
  } catch (cause) {
    throw new StorageError('invalid_argument', 'Invalid storage cursor', { cause });
  }
}
