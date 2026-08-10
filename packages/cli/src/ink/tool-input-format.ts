/** Pure formatting for tool-call labels: input summaries, shell/path/text compaction,
 *  and whole-word tool-name classification. */

/** Human-glanceable tail of a partially-streamed JSON argument object. */
export function formatPendingInputTail(buffer: string, maxLength = 48): string {
  const stripped = buffer.replace(/[{}"\\]/g, '').replace(/\s+/g, ' ').trim();
  if (stripped.length <= maxLength) {
    return stripped || '…';
  }
  return `…${stripped.slice(-maxLength)}`;
}

export function formatToolLabel(name: string, summary: string): string {
  const hasActionPrefix = /^\s*(\$|open |grep |find |search |edit |write |patch |ls )/.test(summary);
  return hasActionPrefix ? summary : `${name}: ${summary}`;
}

export function summarizeToolInput(name: string, value: unknown): string {
  const normalizedName = name.toLowerCase();
  const record = asRecord(value);

  if (record) {
    if (isShellTool(normalizedName)) {
      const cmd = pickString(record, ['command', 'cmd', 'script']) ?? safeStringify(record);
      return `$ ${compactShellCommand(cmd)}`;
    }

    if (isReadTool(normalizedName)) {
      const filePath = pickString(record, ['filePath', 'path', 'file']) ?? safeStringify(record);
      const offset = record['offset'];
      const limit = record['limit'];
      const fileLabel = shortPath(filePath);
      if (typeof offset === 'number' && typeof limit === 'number') {
        return `open ${fileLabel}:${offset}–${offset + limit}`;
      }
      if (typeof offset === 'number') {
        return `open ${fileLabel}:${offset}+`;
      }
      return `open ${fileLabel}`;
    }

    if (isSearchTool(normalizedName)) {
      const pattern = pickString(record, ['pattern', 'query', 'search']);
      const searchPath = pickString(record, ['path', 'cwd', 'dir', 'glob']);
      const toolVerb = normalizedName.includes('grep') ? 'grep' : normalizedName.includes('find') ? 'find' : 'search';
      if (pattern && searchPath) {
        return `${toolVerb} "${compactText(pattern, 40)}" in ${shortPath(searchPath, 40)}`;
      }
      if (pattern) return `${toolVerb} "${compactText(pattern, 60)}"`;
      if (searchPath) return `${toolVerb} ${shortPath(searchPath)}`;
      return `${toolVerb} ${compactText(safeStringify(record))}`;
    }

    if (isMutationTool(normalizedName)) {
      const filePath = pickString(record, ['filePath', 'path', 'file']) ?? safeStringify(record);
      const verb = normalizedName.includes('write') ? 'write' : normalizedName.includes('patch') ? 'patch' : 'edit';
      return `${verb} ${shortPath(filePath)}`;
    }

    if (isListTool(normalizedName)) {
      const dirPath = pickString(record, ['path', 'dir', 'cwd']) ?? '.';
      return `ls ${shortPath(dirPath)}`;
    }

    // 'task' first: sub-agent tools (`<name>_agent`) carry their whole
    // assignment there, and it is the one line worth showing.
    const primary = pickString(record, ['task', 'name', 'title', 'id', 'action', 'query']);
    if (primary) {
      return compactText(primary, 60);
    }
    const keys = Object.keys(record).slice(0, 3);
    return keys.length > 0 ? `input: ${keys.join(', ')}` : 'input object';
  }

  if (value === undefined || value === null) {
    return 'no input';
  }
  if (typeof value === 'string') {
    return compactText(value);
  }
  return compactText(safeStringify(value));
}

/**
 * Shorten a shell command for display:
 * - Single-line commands: compact whitespace and trim to maxLength
 * - Multi-line scripts: show first non-empty line + "…"
 */
function compactShellCommand(cmd: string, maxLength = 80): string {
  const trimmed = cmd.trim();
  const firstNewline = trimmed.indexOf('\n');
  if (firstNewline > 0) {
    const firstLine = trimmed.slice(0, firstNewline).trim();
    return firstLine.length > maxLength
      ? `${firstLine.slice(0, maxLength)}… (+${trimmed.split('\n').length - 1} lines)`
      : `${firstLine} … (+${trimmed.split('\n').length - 1} lines)`;
  }
  const normalized = trimmed.replace(/\s+/g, ' ');
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}…` : normalized;
}

/**
 * Shorten a file path for display, keeping the ends over the middle:
 * - Long path: first segment + last 2 ("packages/…/src/model-registry.ts").
 *   In a monorepo the package name is the most identifying part of a path
 *   and `…/src/model-registry.ts` alone throws it away — every package has
 *   a src/ and most have a model-registry.ts-shaped file somewhere.
 * - Still too long (or too few segments for a head to mean anything):
 *   degrade to the old last-2-segments form.
 */
function shortPath(filePath: string, maxLength = 60): string {
  const normalized = filePath.replace(/\\/g, '/').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  const parts = normalized.split('/').filter(Boolean);
  const tail = parts.slice(-2).join('/');
  if (parts.length > 3) {
    const withHead = `${parts[0]}/…/${tail}`;
    if (withHead.length <= maxLength) {
      return withHead;
    }
  }
  return `…/${tail}`;
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function pickString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

export function compactText(value: string, maxLength = 96): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}…` : normalized;
}

/**
 * Whole-word tool-name classification. Substring matching misfires on
 * embedded words — `researcher_agent` contains "search" and was summarized
 * as a search tool, whose fallback dumped the raw input JSON into every
 * trace. Tokens split on `_`/`-`/`.` so `web_search` still matches.
 */
function nameHasWord(name: string, words: string[]): boolean {
  const tokens = name.split(/[^a-z0-9]+/);
  return tokens.some(token => words.includes(token));
}

function isShellTool(name: string): boolean {
  return nameHasWord(name, ['bash', 'shell', 'exec', 'command', 'cmd']);
}

function isReadTool(name: string): boolean {
  return nameHasWord(name, ['read', 'cat', 'open']);
}

export function isSearchTool(name: string): boolean {
  return nameHasWord(name, ['grep', 'search', 'find']);
}

function isMutationTool(name: string): boolean {
  return nameHasWord(name, ['edit', 'write', 'patch']);
}

export function isListTool(name: string): boolean {
  // Only filesystem-style listers: `task_list` and friends must not be
  // summarized as `ls <path>`.
  return name === 'ls' || name === 'list' || name.startsWith('list_');
}

export function safeStringify(value: unknown): string {
  try {
    if (typeof value === 'string') {
      return value;
    }
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
