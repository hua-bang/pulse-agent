import { createHash } from 'crypto';

/**
 * Pure offloading logic, decoupled from the filesystem so it can be unit-tested.
 * The plugin wires a real `fs/promises`-backed {@link OffloadStore}; tests pass
 * an in-memory one.
 */

export interface OffloadStore {
  /** Absolute directory offloaded files live under. Used only for messaging. */
  dir: string;
  /**
   * Persist `content` under `fileName`. Implementations SHOULD be idempotent:
   * skip the write when a file with identical content already exists (the file
   * name is a content hash, so same name ⇒ same bytes). Never throw on a
   * best-effort basis — return the absolute path that was (or would be) written.
   */
  write(fileName: string, content: string): Promise<string>;
}

export interface OffloadOptions {
  toolName: string;
  threshold: number;
  store: OffloadStore;
  /** Chars kept from the head and from the tail in the inline preview. */
  previewChars?: number;
}

export interface OffloadResult {
  /** The value to hand back to the model in place of the original output. */
  output: unknown;
  /** Absolute path the full output was written to. */
  path: string;
  /** Textual payload size of the original output. */
  payloadSize: number;
}

const DEFAULT_PREVIEW_CHARS = 800;

/**
 * Sum of the lengths of every string reachable in `value`. This is the amount of
 * text that actually lands in the model's context — JSON structural characters
 * (braces, keys, commas) are ignored so a normal, already-capped tool result
 * isn't offloaded just because of wrapper overhead.
 */
export function measurePayloadSize(value: unknown, seen = new Set<object>()): number {
  if (typeof value === 'string') return value.length;
  if (value && typeof value === 'object') {
    if (seen.has(value as object)) return 0;
    seen.add(value as object);
    let total = 0;
    for (const inner of Object.values(value as Record<string, unknown>)) {
      total += measurePayloadSize(inner, seen);
    }
    return total;
  }
  return 0;
}

/** Finds the top-level own string field with the greatest length, if any. */
function findLargestTopLevelStringField(
  obj: Record<string, unknown>,
): { key: string; value: string } | null {
  let best: { key: string; value: string } | null = null;
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string' && (!best || value.length > best.value.length)) {
      best = { key, value };
    }
  }
  return best;
}

function sanitizeToolName(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned || 'tool';
}

function contentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

function formatCount(n: number): string {
  return n.toLocaleString('en-US');
}

/**
 * Builds the compact stub string that replaces a large payload. Contains a
 * head/tail preview plus the absolute path and instructions on how to read the
 * rest on demand.
 */
export function buildStub(params: {
  toolName: string;
  content: string;
  filePath: string;
  previewChars: number;
}): string {
  const { toolName, content, filePath, previewChars } = params;
  const chars = content.length;
  const lines = content.split('\n').length;

  let previewBlock: string;
  if (chars <= previewChars * 2) {
    previewBlock = content;
  } else {
    const head = content.slice(0, previewChars);
    const tail = content.slice(-previewChars);
    const omitted = chars - previewChars * 2;
    previewBlock = `${head}\n\n…[${formatCount(omitted)} chars omitted]…\n\n${tail}`;
  }

  return [
    `⚠️ Large \`${toolName}\` output offloaded to disk (${formatCount(chars)} chars / ${formatCount(lines)} lines). The full result is NOT in context.`,
    '',
    'Preview (head + tail):',
    previewBlock,
    '',
    `Full output saved to: ${filePath}`,
    'To inspect the rest, use the `read` tool with this filePath (plus offset/limit) or `grep` to search it. Do not read the whole file at once.',
  ].join('\n');
}

/**
 * Offloads `output` to disk when its textual payload exceeds `threshold`.
 * Returns `null` (no change) when the output is small enough to keep inline.
 *
 * Shape preservation: when the output is an object dominated by a single
 * top-level string field (e.g. `read` → `{ content, totalLines }`), only that
 * field is replaced with the stub so metadata survives. Otherwise (plain string,
 * array, or many medium fields) the whole value is serialized to disk and the
 * output becomes the stub string.
 */
export async function offloadToolOutput(
  output: unknown,
  opts: OffloadOptions,
): Promise<OffloadResult | null> {
  const { toolName, threshold, store } = opts;
  const previewChars = opts.previewChars ?? DEFAULT_PREVIEW_CHARS;

  const payloadSize = measurePayloadSize(output);
  if (payloadSize <= threshold) return null;

  const safeName = sanitizeToolName(toolName);

  // Case 1: object with one dominant, over-threshold top-level string field.
  if (output && typeof output === 'object' && !Array.isArray(output)) {
    const record = output as Record<string, unknown>;
    const largest = findLargestTopLevelStringField(record);
    if (largest && largest.value.length > threshold) {
      const fileName = `${safeName}-${contentHash(largest.value)}.txt`;
      const filePath = await store.write(fileName, largest.value);
      const stub = buildStub({ toolName, content: largest.value, filePath, previewChars });
      return {
        output: { ...record, [largest.key]: stub },
        path: filePath,
        payloadSize,
      };
    }
  }

  // Case 2: plain string.
  if (typeof output === 'string') {
    const fileName = `${safeName}-${contentHash(output)}.txt`;
    const filePath = await store.write(fileName, output);
    const stub = buildStub({ toolName, content: output, filePath, previewChars });
    return { output: stub, path: filePath, payloadSize };
  }

  // Case 3: array / many-field object — serialize the whole thing as JSON.
  const json = JSON.stringify(output, null, 2);
  const fileName = `${safeName}-${contentHash(json)}.json`;
  const filePath = await store.write(fileName, json);
  const stub = buildStub({ toolName, content: json, filePath, previewChars });
  return { output: stub, path: filePath, payloadSize };
}
