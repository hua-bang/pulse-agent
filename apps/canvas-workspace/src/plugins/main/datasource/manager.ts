/**
 * DataSourceManager — in-process datasource hosting.
 *
 * Owns one shared loopback HTTP server with three route families:
 *
 *   GET /api/<id>          → latest JSON snapshot
 *   GET /api/<id>/stream   → SSE event stream of every shaped value
 *   GET /ui/<id>           → iframe page (built from spec.presentation)
 *
 * /api/* is the headless data interface — usable by the bundled iframe
 * page, by other tooling, by `curl`, by future "reference" presentations
 * that bind multiple iframes to the same datasource. /ui/* is one
 * particular HTML embedding for the canvas iframe node.
 */

import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { app } from "electron";
import { startHttpPoll, type RunnerHandle } from "./runners/http-poll";
import { startMock } from "./runners/mock";
import { runTransform } from "./sandbox-runner";
import { getTemplate } from "./templates";
import type {
  DatasourceSpec,
  InlineHtmlPresentation,
  PresentationSpec,
} from "./types";

interface Runner {
  id: string;
  spec: DatasourceSpec;
  fetcher: RunnerHandle;
  /** Last shaped value pushed to clients. Undefined until the first
   *  successful fetch + transform. */
  latest: unknown;
  clients: Set<ServerResponse>;
  /** Pre-rendered HTML page served at `/ui/<id>`. */
  indexHtml: string;
  startedAt: number;
}

function escapeForScriptTag(value: string): string {
  // </script> inside a string literal breaks out of the injected
  // <script> block. HTML parser only looks for the literal sequence
  // "</script", case-insensitive — escaping the `<` is enough.
  return value.replace(/<\/(script)/gi, "<\\/$1");
}

/** Wrap LLM-authored html/script/css into the same page shape templates
 *  use. Templates and inline_html therefore both reach the iframe via
 *  identical scaffolding — only the body differs. */
function renderInlineHtml(spec: InlineHtmlPresentation, endpoint: string): string {
  const userScript = spec.script
    ? `<script>(function(){\n${spec.script}\n})();</script>`
    : "";
  const userCss = spec.css ? `<style>${spec.css}</style>` : "";
  const initScript = `<script>window.__ENDPOINT__ = ${JSON.stringify(escapeForScriptTag(endpoint))};</script>`;
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>datasource</title>
<style>
  html, body { margin: 0; padding: 0; }
  body { font: 14px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; padding: 12px; }
</style>
${userCss}
</head>
<body>
${spec.html}
${initScript}
${userScript}
</body>
</html>`;
}

function renderPresentation(
  presentation: PresentationSpec,
  dsUrl: string,
): string {
  if (presentation.type === "inline_html") {
    return renderInlineHtml(presentation, `${dsUrl}/stream`);
  }
  if (presentation.type === "template") {
    const tpl = getTemplate(presentation.template);
    const parsed = tpl.paramsSchema.safeParse(presentation.params);
    if (!parsed.success) {
      throw new Error(
        `template "${presentation.template}": invalid params — ${parsed.error.message}`,
      );
    }
    return tpl.render(parsed.data, { dsUrl });
  }
  // exhaustiveness guard
  const exhaustive: never = presentation;
  throw new Error(
    `unknown presentation type: ${JSON.stringify((exhaustive as { type?: string }).type)}`,
  );
}

const UI_RE = /^\/ui\/([^/?#]+)\/?$/;
const API_SNAPSHOT_RE = /^\/api\/([^/?#]+)\/?$/;
const API_STREAM_RE = /^\/api\/([^/?#]+)\/stream\/?$/;

export class DataSourceManager {
  private runners = new Map<string, Runner>();
  private server: http.Server | null = null;
  private serverPort: number | null = null;
  private serverReady: Promise<number> | null = null;
  private shutdownInstalled = false;

  private installShutdownHook(): void {
    if (this.shutdownInstalled) return;
    this.shutdownInstalled = true;
    app.on("before-quit", () => {
      for (const r of this.runners.values()) {
        try { r.fetcher.stop(); } catch { /* ignore */ }
        for (const c of r.clients) {
          try { c.end(); } catch { /* ignore */ }
        }
      }
      this.runners.clear();
      this.server?.close();
      this.server = null;
      this.serverPort = null;
      this.serverReady = null;
    });
  }

  private async ensureServer(): Promise<number> {
    if (this.serverPort != null) return this.serverPort;
    if (this.serverReady) return this.serverReady;

    this.serverReady = new Promise<number>((resolve, reject) => {
      const server = http.createServer((req, res) =>
        this.handleRequest(req, res),
      );
      server.once("error", (err) => {
        this.serverReady = null;
        reject(err);
      });
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (!addr || typeof addr === "string") {
          reject(new Error("failed to bind datasource server"));
          return;
        }
        this.server = server;
        this.serverPort = addr.port;
        resolve(addr.port);
      });
    });
    return this.serverReady;
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const url = req.url ?? "/";

    let m = UI_RE.exec(url);
    if (m) {
      const runner = this.runners.get(decodeURIComponent(m[1]));
      if (!runner) return this.send404(res);
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(runner.indexHtml);
      return;
    }

    m = API_STREAM_RE.exec(url);
    if (m) {
      const runner = this.runners.get(decodeURIComponent(m[1]));
      if (!runner) return this.send404(res);
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
      });
      // Flush headers immediately so the client enters OPEN state.
      res.write(":ok\n\n");
      if (runner.latest !== undefined) {
        res.write(`data: ${JSON.stringify(runner.latest)}\n\n`);
      }
      runner.clients.add(res);
      req.on("close", () => runner.clients.delete(res));
      return;
    }

    m = API_SNAPSHOT_RE.exec(url);
    if (m) {
      const runner = this.runners.get(decodeURIComponent(m[1]));
      if (!runner) return this.send404(res);
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(runner.latest ?? null));
      return;
    }

    this.send404(res);
  }

  private send404(res: ServerResponse): void {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  }

  /** Public URL for the iframe canvas node to load. */
  private buildUiUrl(id: string): string {
    if (this.serverPort == null) {
      throw new Error("datasource server not yet bound");
    }
    return `http://127.0.0.1:${this.serverPort}/ui/${encodeURIComponent(id)}`;
  }

  /** Data API base — `${dsUrl}` is the snapshot, `${dsUrl}/stream` is SSE. */
  private buildDsUrl(id: string): string {
    if (this.serverPort == null) {
      throw new Error("datasource server not yet bound");
    }
    return `http://127.0.0.1:${this.serverPort}/api/${encodeURIComponent(id)}`;
  }

  private pushData(runner: Runner, value: unknown): void {
    runner.latest = value;
    const line = `data: ${JSON.stringify(value)}\n\n`;
    for (const client of runner.clients) {
      try { client.write(line); } catch { /* close handler cleans up */ }
    }
  }

  private pushError(runner: Runner, err: Error): void {
    const line = `event: error\ndata: ${JSON.stringify({ message: err.message })}\n\n`;
    for (const client of runner.clients) {
      try { client.write(line); } catch { /* ignore */ }
    }
  }

  private startFetcher(spec: DatasourceSpec, runner: Runner): RunnerHandle {
    const onData = async (raw: unknown): Promise<void> => {
      try {
        const shaped = spec.transform
          ? await runTransform(spec.transform.code, raw)
          : raw;
        this.pushData(runner, shaped);
      } catch (err) {
        this.pushError(runner, err instanceof Error ? err : new Error(String(err)));
      }
    };
    const onError = (err: Error): void => this.pushError(runner, err);

    const fetcher = spec.fetcher;
    if (fetcher.type === "http_poll") {
      return startHttpPoll(fetcher, { onData: (v) => void onData(v), onError });
    }
    if (fetcher.type === "mock") {
      return startMock(fetcher, { onData: (v) => void onData(v), onError });
    }
    throw new Error(
      `unknown fetcher type: ${JSON.stringify((fetcher as { type?: string }).type)}`,
    );
  }

  async start(id: string, spec: DatasourceSpec): Promise<{ url: string }> {
    this.installShutdownHook();
    await this.stop(id);
    await this.ensureServer();

    // Render presentation HTML up-front so a bad template / param spec
    // surfaces synchronously and we don't even register the runner.
    const indexHtml = renderPresentation(spec.presentation, this.buildDsUrl(id));

    const runner: Runner = {
      id,
      spec,
      fetcher: { stop: () => undefined }, // overwritten below
      latest: undefined,
      clients: new Set(),
      indexHtml,
      startedAt: Date.now(),
    };
    runner.fetcher = this.startFetcher(spec, runner);

    this.runners.set(id, runner);
    return { url: this.buildUiUrl(id) };
  }

  async stop(id: string): Promise<void> {
    const r = this.runners.get(id);
    if (!r) return;
    this.runners.delete(id);
    try { r.fetcher.stop(); } catch { /* ignore */ }
    for (const client of r.clients) {
      try { client.end(); } catch { /* ignore */ }
    }
  }

  list(): Array<{ id: string; startedAt: number; url: string | null }> {
    return Array.from(this.runners.values()).map((r) => ({
      id: r.id,
      startedAt: r.startedAt,
      url: this.serverPort == null ? null : this.buildUiUrl(r.id),
    }));
  }
}
