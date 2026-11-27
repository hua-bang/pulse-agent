import { readFile, realpath, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, resolve } from 'node:path';
import { isPathWithin } from './auth.js';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
};

function cacheControlFor(pathname: string, ext: string): string {
  if (ext === '.html' || pathname === '/' || ext === '.webmanifest') {
    return 'no-cache';
  }
  if (pathname.startsWith('/assets/')) {
    return 'public, max-age=31536000, immutable';
  }
  return 'public, max-age=300';
}

/**
 * Serve prebuilt Pulse Canvas Web/H5 static assets from `webDir`.
 * Never handles `/v1/*` or `/health` routes; strictly confines file reads to `webDir`.
 */
export async function handleStaticWebRequest(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  webDir: string,
): Promise<boolean> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return false;
  }
  if (url.pathname === '/health' || url.pathname === '/v1' || url.pathname.startsWith('/v1/')) {
    return false;
  }

  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Bad Request');
    return true;
  }

  if (decodedPath.includes('\0')) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Bad Request');
    return true;
  }

  const rootDir = resolve(webDir);
  const realRoot = await realpath(rootDir).catch(() => rootDir);
  const relativePath = decodedPath === '/' ? 'index.html' : decodedPath.replace(/^\/+/, '');
  let candidatePath = resolve(rootDir, relativePath);

  if (!isPathWithin(rootDir, candidatePath)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return true;
  }

  let fileToServe: string | null = null;
  try {
    const info = await stat(candidatePath);
    if (info.isFile()) {
      const realCandidate = await realpath(candidatePath);
      if (!isPathWithin(realRoot, realCandidate)) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Forbidden');
        return true;
      }
      fileToServe = realCandidate;
    }
  } catch {
    // Fall through to SPA fallback for extensionless routes.
  }

  if (!fileToServe && !extname(relativePath)) {
    const indexPath = join(rootDir, 'index.html');
    try {
      const info = await stat(indexPath);
      if (info.isFile()) {
        const realIndex = await realpath(indexPath);
        if (isPathWithin(realRoot, realIndex)) {
          fileToServe = realIndex;
        }
      }
    } catch {
      // Missing index.html -> 404 below.
    }
  }

  if (!fileToServe) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
    return true;
  }

  const ext = extname(fileToServe).toLowerCase();
  const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';
  const body = await readFile(fileToServe);
  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': body.byteLength,
    'Cache-Control': cacheControlFor(decodedPath, ext),
    'X-Content-Type-Options': 'nosniff',
  });
  if (req.method === 'HEAD') {
    res.end();
  } else {
    res.end(body);
  }
  return true;
}
