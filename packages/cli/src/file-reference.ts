import * as fs from 'fs/promises';
import * as path from 'path';

export interface FileEntry {
  /** Path relative to the workspace root, POSIX separators. */
  relPath: string;
  isDirectory: boolean;
}

export interface ExpansionLimits {
  /** Max bytes read per referenced file. */
  maxFileBytes?: number;
  /** Max files attached in a single message (directories expand to their direct children). */
  maxFiles?: number;
  /** Max direct children pulled in per referenced directory. */
  maxDirEntries?: number;
}

export interface ExpansionResult {
  /** The message with `@path` tokens kept, plus attached file contents appended. */
  text: string;
  attached: string[];
  skipped: Array<{ ref: string; reason: string }>;
}

const DEFAULT_LIMITS: Required<ExpansionLimits> = {
  maxFileBytes: 64 * 1024,
  maxFiles: 20,
  maxDirEntries: 40,
};

const ALWAYS_IGNORED = new Set([
  '.git', 'node_modules', 'dist', 'build', 'out', 'coverage',
  '.next', '.turbo', '.cache', '.venv', '__pycache__',
]);

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp', '.tiff',
  '.pdf', '.zip', '.gz', '.tar', '.bz2', '.xz', '.7z', '.rar',
  '.mp3', '.mp4', '.mov', '.avi', '.wav', '.flac', '.webm',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.so', '.dylib', '.dll', '.exe', '.bin', '.wasm', '.node',
  '.sqlite', '.db', '.lock',
]);

/**
 * Detects an in-progress `@` reference immediately before the cursor.
 * Returns the partial query (may be empty) or null when the cursor is not in
 * one. A `@` only counts at a word boundary, so emails and decorators do not
 * trigger it.
 */
export function detectFileReferenceQuery(input: string, cursor: number): { query: string; start: number } | null {
  const position = Math.max(0, Math.min(input.length, cursor));
  const before = input.slice(0, position);
  const match = before.match(/(^|\s)@([^\s@]*)$/);
  if (!match) {
    return null;
  }
  return { query: match[2], start: position - match[2].length - 1 };
}

/** Replaces the in-progress `@query` before the cursor with the chosen path. */
export function applyFileReference(input: string, cursor: number, relPath: string): { input: string; cursor: number } {
  const detected = detectFileReferenceQuery(input, cursor);
  if (!detected) {
    return { input, cursor };
  }
  const completed = `@${relPath} `;
  const next = `${input.slice(0, detected.start)}${completed}${input.slice(cursor)}`;
  return { input: next, cursor: detected.start + completed.length };
}

/** Extracts `@path` tokens from a submitted message. */
export function extractFileReferences(input: string): string[] {
  const refs: string[] = [];
  const pattern = /(?:^|\s)@([^\s@]+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(input)) !== null) {
    const ref = match[1].replace(/[.,;:)\]}]+$/, '');
    if (ref && !refs.includes(ref)) {
      refs.push(ref);
    }
  }
  return refs;
}

function parseIgnorePatterns(gitignore: string): string[] {
  return gitignore
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#') && !line.startsWith('!'))
    .map(line => line.replace(/\/+$/, '').replace(/^\/+/, ''));
}

/** Deliberately simple .gitignore matching: exact segment, prefix, or `*.ext`. */
export function isIgnored(relPath: string, patterns: string[]): boolean {
  const segments = relPath.split('/');
  if (segments.some(segment => ALWAYS_IGNORED.has(segment))) {
    return true;
  }
  return patterns.some(pattern => {
    if (pattern.startsWith('*.')) {
      return relPath.endsWith(pattern.slice(1));
    }
    return segments.includes(pattern) || relPath === pattern || relPath.startsWith(`${pattern}/`);
  });
}

/**
 * Walks the workspace for `@` completion candidates. Bounded by `limit` so a
 * huge repo cannot stall the composer; directories are listed as candidates
 * too, so `@src/` can attach a folder.
 */
export async function indexWorkspaceFiles(root = process.cwd(), limit = 2000): Promise<FileEntry[]> {
  let patterns: string[] = [];
  try {
    patterns = parseIgnorePatterns(await fs.readFile(path.join(root, '.gitignore'), 'utf-8'));
  } catch {
    patterns = [];
  }

  const entries: FileEntry[] = [];
  const queue: string[] = [''];

  while (queue.length > 0 && entries.length < limit) {
    const relDir = queue.shift()!;
    let dirents;
    try {
      dirents = await fs.readdir(path.join(root, relDir), { withFileTypes: true });
    } catch {
      continue;
    }

    for (const dirent of dirents) {
      if (entries.length >= limit) {
        break;
      }
      const relPath = relDir ? `${relDir}/${dirent.name}` : dirent.name;
      if (isIgnored(relPath, patterns)) {
        continue;
      }
      if (dirent.isDirectory()) {
        entries.push({ relPath, isDirectory: true });
        queue.push(relPath);
      } else if (dirent.isFile()) {
        entries.push({ relPath, isDirectory: false });
      }
    }
  }

  return entries;
}

export function filterFileEntries(entries: FileEntry[], query: string, limit = 8): FileEntry[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return entries.slice(0, limit);
  }

  const scored = entries
    .map(entry => {
      const lower = entry.relPath.toLowerCase();
      const base = lower.split('/').pop() ?? lower;
      if (base.startsWith(normalized)) return { entry, score: 0 };
      if (lower.startsWith(normalized)) return { entry, score: 1 };
      if (base.includes(normalized)) return { entry, score: 2 };
      if (lower.includes(normalized)) return { entry, score: 3 };
      return null;
    })
    .filter((item): item is { entry: FileEntry; score: number } => item !== null);

  scored.sort((a, b) => a.score - b.score || a.entry.relPath.length - b.entry.relPath.length);
  return scored.slice(0, limit).map(item => item.entry);
}

function looksBinary(relPath: string, buffer: Buffer): boolean {
  if (BINARY_EXTENSIONS.has(path.extname(relPath).toLowerCase())) {
    return true;
  }
  // A NUL byte in the head is the classic binary tell.
  return buffer.subarray(0, 4096).includes(0);
}

/**
 * True when `absolute` is the workspace root or lives beneath it.
 *
 * A raw `startsWith(root)` is NOT enough: it has no path-separator boundary, so
 * a sibling directory whose name merely extends the root's basename
 * (`/w/project` vs `/w/project-secrets`) passes the check and leaks outside the
 * workspace. `path.relative` gives us that boundary for free.
 */
export function isInsideWorkspace(absolute: string, root: string): boolean {
  const relative = path.relative(path.resolve(root), absolute);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/**
 * Expands `@path` references in a submitted message into attached file
 * contents. The original text (including the `@path` tokens) is preserved so
 * the model still sees what the user pointed at; contents are appended below.
 */
export async function expandFileReferences(
  input: string,
  root = process.cwd(),
  limits: ExpansionLimits = {},
): Promise<ExpansionResult> {
  const { maxFileBytes, maxFiles, maxDirEntries } = { ...DEFAULT_LIMITS, ...limits };
  const refs = extractFileReferences(input);
  if (refs.length === 0) {
    return { text: input, attached: [], skipped: [] };
  }

  const attached: string[] = [];
  const skipped: Array<{ ref: string; reason: string }> = [];
  const blocks: string[] = [];

  for (const ref of refs) {
    if (attached.length >= maxFiles) {
      skipped.push({ ref, reason: `attachment limit (${maxFiles}) reached` });
      continue;
    }

    const absolute = path.resolve(root, ref);
    if (!isInsideWorkspace(absolute, root)) {
      skipped.push({ ref, reason: 'outside the workspace' });
      continue;
    }

    let stat;
    try {
      stat = await fs.stat(absolute);
    } catch {
      skipped.push({ ref, reason: 'not found' });
      continue;
    }

    if (stat.isDirectory()) {
      try {
        const dirents = await fs.readdir(absolute, { withFileTypes: true });
        const listing = dirents
          .slice(0, maxDirEntries)
          .map(dirent => `${dirent.name}${dirent.isDirectory() ? '/' : ''}`)
          .join('\n');
        const more = dirents.length > maxDirEntries ? `\n… +${dirents.length - maxDirEntries} more entries` : '';
        blocks.push(`--- @${ref} (directory listing) ---\n${listing}${more}`);
        attached.push(ref);
      } catch {
        skipped.push({ ref, reason: 'unreadable directory' });
      }
      continue;
    }

    if (!stat.isFile()) {
      skipped.push({ ref, reason: 'not a regular file' });
      continue;
    }

    try {
      const handle = await fs.open(absolute, 'r');
      try {
        const buffer = Buffer.alloc(Math.min(stat.size, maxFileBytes));
        await handle.read(buffer, 0, buffer.length, 0);
        if (looksBinary(ref, buffer)) {
          skipped.push({ ref, reason: 'binary file' });
          continue;
        }
        const truncated = stat.size > maxFileBytes
          ? `\n… truncated at ${maxFileBytes} bytes (file is ${stat.size} bytes)`
          : '';
        blocks.push(`--- @${ref} ---\n${buffer.toString('utf-8')}${truncated}`);
        attached.push(ref);
      } finally {
        await handle.close();
      }
    } catch {
      skipped.push({ ref, reason: 'unreadable file' });
    }
  }

  if (blocks.length === 0) {
    return { text: input, attached, skipped };
  }

  return {
    text: `${input}\n\n${blocks.join('\n\n')}`,
    attached,
    skipped,
  };
}
