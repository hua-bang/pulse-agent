import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { relative, resolve } from 'node:path';

export function verifyBearerToken(req: IncomingMessage, expectedToken: string): boolean {
  const header = req.headers.authorization;
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false;
  const provided = header.slice('Bearer '.length).trim();
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expectedToken, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

const REMOTE_URI_PREFIX = 'pulse-remote://';

/**
 * Resolve a `pulse-remote://<rel>` URI strictly inside `rootDir`.
 * Rejects path traversal (`..`), absolute escapes, or non-matching prefixes.
 */
export function resolveRemoteFilePath(rootDir: string, uri: string): string | null {
  if (!uri.startsWith(REMOTE_URI_PREFIX)) return null;
  const raw = uri.slice(REMOTE_URI_PREFIX.length).replace(/^\/+/, '');
  if (!raw || raw.includes('\0')) return null;
  const root = resolve(rootDir);
  const full = resolve(root, raw);
  const rel = relative(root, full);
  if (!rel || rel.startsWith('..') || rel.includes('../') || rel.includes('..\\')) {
    return null;
  }
  return full;
}

export async function readJsonBody<T = unknown>(
  req: IncomingMessage,
  maxBytes = 16 * 1024 * 1024,
): Promise<T> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;
    total += buf.length;
    if (total > maxBytes) {
      throw new Error(`Request body exceeded ${maxBytes} bytes`);
    }
    chunks.push(buf);
  }
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) return {} as T;
  return JSON.parse(text) as T;
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}
