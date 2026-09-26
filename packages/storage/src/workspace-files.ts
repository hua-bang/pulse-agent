/**
 * Markdown and attachments stay ordinary files. Hosts reach them through this
 * repository, addressed by URI and a content version, so every read and write
 * shares one version scheme with durable file write intents.
 */

/** Content version of a file: `sha256:` followed by the hex digest of its bytes. */
export type FileContentVersion = string;

export interface FileBytes {
  uri: string;
  version: FileContentVersion;
  bytes: Uint8Array;
}

export interface FileText {
  uri: string;
  version: FileContentVersion;
  /** Decoded as UTF-8; the version always describes the stored bytes. */
  content: string;
}

export interface FileWriteOptions {
  /**
   * Omitted: create or replace unconditionally. `null`: create only; fail if
   * the file exists. A version: replace only while the file still has it.
   * A failed condition rejects with `revision_conflict`.
   */
  expectedVersion?: FileContentVersion | null;
}

export interface FileWriteReceipt {
  uri: string;
  version: FileContentVersion;
}

export interface WorkspaceFiles {
  /** URI for an absolute local path. */
  uriForPath(path: string): string;
  /**
   * Explicit escape hatch for consumers that need a real path, such as
   * terminal agents or `AGENTS.md`. Content access should use read/write.
   */
  localPath(uri: string): string;
  /** `null` when the file does not exist. */
  readBytes(uri: string): Promise<FileBytes | null>;
  readText(uri: string): Promise<FileText | null>;
  write(uri: string, content: string | Uint8Array, options?: FileWriteOptions): Promise<FileWriteReceipt>;
  /** With an expected version, removes only while the file still has it. */
  remove(uri: string, options?: { expectedVersion?: FileContentVersion }): Promise<void>;
  /**
   * Calls `onChange` (coalescing is the caller's concern) until the returned
   * stop function runs. A watcher that fails is closed and reports `onError`.
   * Throws when the directory cannot be watched at all.
   */
  watchDirectory(uri: string, onChange: () => void, onError?: () => void): () => void;
}

const VERSION_PREFIX = 'sha256:';

/**
 * Compare content versions. Earlier Canvas releases stored the bare hex
 * digest; it names the same bytes as the prefixed form.
 */
export function sameFileVersion(left: string | null | undefined, right: string | null | undefined): boolean {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const strip = (value: string) => (value.startsWith(VERSION_PREFIX) ? value.slice(VERSION_PREFIX.length) : value);
  return strip(left) === strip(right);
}
