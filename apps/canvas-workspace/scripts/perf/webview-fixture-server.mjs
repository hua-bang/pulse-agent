import { createServer } from 'node:http';

const HOST = '127.0.0.1';
const ROUTE_PREFIX = '/perf-webview/';

export const WEBVIEW_FIXTURE_READY_MARKER = '__pulsePerfWebviewReady';
export const WEBVIEW_FIXTURE_INSTANCE_TOKEN = '__pulsePerfWebviewInstanceToken';

const escapeHtml = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

const fixtureHtml = (fixtureId) => {
  const cards = Array.from({ length: 18 }, (_, index) => `
          <article class="card">
            <span class="card__number">${String(index + 1).padStart(2, '0')}</span>
            <span class="card__bar"></span>
            <span class="card__bar card__bar--short"></span>
          </article>`).join('');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
    <link rel="icon" href="data:,">
    <title>Pulse performance fixture</title>
    <style>
      :root {
        color-scheme: dark;
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #11131a;
        color: #eef1f8;
      }

      * { box-sizing: border-box; }

      body {
        min-height: 100vh;
        margin: 0;
        padding: 24px;
        background:
          radial-gradient(circle at 12% 18%, rgba(105, 86, 229, 0.24), transparent 34%),
          linear-gradient(145deg, #151824, #0e1016 72%);
      }

      main {
        width: min(760px, 100%);
        margin: 0 auto;
      }

      header {
        display: flex;
        align-items: end;
        justify-content: space-between;
        gap: 20px;
        margin-bottom: 20px;
      }

      h1 {
        margin: 0;
        font-size: 22px;
        letter-spacing: -0.02em;
      }

      .fixture-id {
        color: #9ba4ba;
        font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
      }

      .grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 12px;
      }

      .card {
        min-height: 92px;
        padding: 14px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.045);
        box-shadow: 0 12px 28px rgba(0, 0, 0, 0.18);
      }

      .card__number {
        display: block;
        margin-bottom: 18px;
        color: #a99df5;
        font: 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
      }

      .card__bar {
        display: block;
        width: 78%;
        height: 7px;
        margin-top: 8px;
        border-radius: 999px;
        background: rgba(238, 241, 248, 0.16);
      }

      .card__bar--short { width: 48%; }

      @media (max-width: 520px) {
        body { padding: 16px; }
        .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      }
    </style>
  </head>
  <body>
    <main data-fixture-id="${escapeHtml(fixtureId)}">
      <header>
        <h1>Embedded webpage fixture</h1>
        <span class="fixture-id">${escapeHtml(fixtureId)}</span>
      </header>
      <section class="grid" aria-label="Deterministic fixture cards">${cards}
      </section>
    </main>
    <script>
      window.${WEBVIEW_FIXTURE_INSTANCE_TOKEN} = (
        globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function'
          ? globalThis.crypto.randomUUID()
          : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2)
      );
      window.${WEBVIEW_FIXTURE_READY_MARKER} = true;
      document.documentElement.dataset.pulsePerfWebviewReady = 'true';
    </script>
  </body>
</html>`;
};

const writeText = (response, statusCode, body, headers = {}) => {
  response.writeHead(statusCode, {
    'cache-control': 'no-store',
    connection: 'close',
    'content-length': Buffer.byteLength(body),
    'content-type': 'text/plain; charset=utf-8',
    'x-content-type-options': 'nosniff',
    ...headers,
  });
  response.end(body);
};

export const startWebviewFixtureServer = async () => {
  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url ?? '/', `http://${HOST}`);
    const encodedFixtureId = requestUrl.pathname.startsWith(ROUTE_PREFIX)
      ? requestUrl.pathname.slice(ROUTE_PREFIX.length)
      : '';

    if (!encodedFixtureId || encodedFixtureId.includes('/')) {
      writeText(response, 404, 'Not found');
      return;
    }

    if (request.method !== 'GET') {
      writeText(response, 405, 'Method not allowed', { allow: 'GET' });
      return;
    }

    let fixtureId;
    try {
      fixtureId = decodeURIComponent(encodedFixtureId);
    } catch {
      writeText(response, 400, 'Invalid fixture id');
      return;
    }

    const body = fixtureHtml(fixtureId);
    writeText(response, 200, body, { 'content-type': 'text/html; charset=utf-8' });
  });

  await new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };

    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(0, HOST);
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    await new Promise((resolve) => server.close(resolve));
    throw new Error('webview fixture server did not expose an IPv4 address');
  }

  const baseUrl = `http://${HOST}:${address.port}`;
  let closePromise;

  const close = () => {
    if (closePromise) return closePromise;

    closePromise = new Promise((resolve, reject) => {
      if (!server.listening) {
        resolve();
        return;
      }

      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
      server.closeIdleConnections?.();
    });

    return closePromise;
  };

  const urlFor = (fixtureId) => {
    if (fixtureId === null || fixtureId === undefined || String(fixtureId).trim() === '') {
      throw new Error('fixture id must be a non-empty value');
    }
    return `${baseUrl}${ROUTE_PREFIX}${encodeURIComponent(String(fixtureId))}`;
  };

  return { baseUrl, urlFor, close };
};
