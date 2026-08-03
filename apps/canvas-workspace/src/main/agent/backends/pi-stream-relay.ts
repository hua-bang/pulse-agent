import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';

/**
 * Loopback SSE-normalizing relay for the pi model bridge.
 *
 * Empirically (see docs/09): some third-party OpenAI-compatible proxies
 * stream content deltas and `[DONE]` but never emit a chunk carrying
 * `finish_reason`. The engine's AI-SDK client tolerates that; pi's client
 * fails the turn with "Stream ended without finish_reason". The bridge
 * therefore points pi at this relay instead of the upstream: requests are
 * forwarded verbatim (Authorization included — the key still comes from
 * pi's models.json), and on the way back a missing `finish_reason` gets a
 * synthesized `finish_reason:"stop"` chunk injected before `[DONE]`, which
 * is also appended when the upstream ends the stream without one.
 *
 * Loopback-only and no privilege amplification: the relay can only reach
 * the one upstream the bridge configured, with credentials the caller
 * already holds. Non-SSE responses (errors, JSON) pass through untouched.
 */

let server: Server | null = null;
let origin: string | null = null;
let upstreamBase = '';

const FORWARD_HEADERS = ['authorization', 'content-type', 'accept'] as const;

function synthesizedFinishChunk(model: string | undefined): string {
  return `data: ${JSON.stringify({
    id: 'pulse-relay-finish',
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: model ?? 'unknown',
    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
  })}\n\n`;
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const body = Buffer.concat(chunks);
  let requestedModel: string | undefined;
  try { requestedModel = JSON.parse(body.toString('utf8'))?.model; } catch { /* non-JSON */ }

  const headers: Record<string, string> = {};
  for (const name of FORWARD_HEADERS) {
    const value = req.headers[name];
    if (typeof value === 'string') headers[name] = value;
  }

  const abort = new AbortController();
  req.on('close', () => abort.abort());

  let upstream: Response;
  try {
    upstream = await fetch(`${upstreamBase}${req.url ?? ''}`, {
      method: req.method ?? 'POST',
      headers,
      body: body.length > 0 ? body : undefined,
      signal: abort.signal,
    });
  } catch (error) {
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: `relay upstream fetch failed: ${(error as Error).message}` } }));
    return;
  }

  const contentType = upstream.headers.get('content-type') ?? 'application/octet-stream';
  res.writeHead(upstream.status, { 'content-type': contentType });
  if (!upstream.body) { res.end(); return; }

  if (!contentType.includes('text/event-stream')) {
    res.end(Buffer.from(await upstream.arrayBuffer()));
    return;
  }

  // SSE path: forward event-by-event, tracking whether any chunk carried a
  // non-null finish_reason; heal the ending when none did.
  const decoder = new TextDecoder();
  let buffer = '';
  let sawFinish = false;
  let ended = false;
  const writeEvent = (event: string) => { res.write(`${event}\n\n`); };
  const handleEvent = (event: string) => {
    const data = event.split('\n').filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trim()).join('');
    if (data === '[DONE]') {
      if (!sawFinish) writeEvent(synthesizedFinishChunk(requestedModel));
      ended = true;
      writeEvent(event);
      return;
    }
    if (data) {
      try {
        const parsed = JSON.parse(data);
        if (Array.isArray(parsed?.choices) && parsed.choices.some((c: any) => c?.finish_reason)) {
          sawFinish = true;
        }
      } catch { /* forward opaque events untouched */ }
    }
    writeEvent(event);
  };

  const reader = upstream.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let split = buffer.indexOf('\n\n');
      while (split >= 0) {
        handleEvent(buffer.slice(0, split));
        buffer = buffer.slice(split + 2);
        split = buffer.indexOf('\n\n');
      }
    }
    if (buffer.trim()) handleEvent(buffer.trimEnd());
    if (!ended) {
      if (!sawFinish) writeEvent(synthesizedFinishChunk(requestedModel));
      writeEvent('data: [DONE]');
    }
  } catch { /* client or upstream went away mid-stream */ }
  res.end();
}

/**
 * Ensure the relay is listening and pointed at `upstream` (no trailing
 * slash needed). Returns the relay origin to use as the provider baseUrl.
 */
export async function ensurePiStreamRelay(upstream: string): Promise<string> {
  upstreamBase = upstream.replace(/\/+$/, '');
  if (server && origin) return origin;
  server = createServer((req, res) => { void handle(req, res); });
  origin = await new Promise<string>((resolve, reject) => {
    server!.once('error', reject);
    server!.listen(0, '127.0.0.1', () => {
      const addr = server!.address();
      if (!addr || typeof addr !== 'object') { reject(new Error('pi relay failed to bind')); return; }
      resolve(`http://127.0.0.1:${addr.port}`);
    });
  });
  server.unref();
  return origin;
}

/** Test hook: tear the singleton down so suites can rebind cleanly. */
export async function stopPiStreamRelay(): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = null;
  origin = null;
}
