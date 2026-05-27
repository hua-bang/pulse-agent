/**
 * DataSourceManager — in-process datasource hosting.
 *
 * One shared loopback HTTP server, one in-memory `Runner` per active
 * datasource. The previous design forked a Node child per datasource
 * and made each its own HTTP server; that bought process isolation we
 * weren't actually using (transforms already run inside a vm sandbox,
 * fetchers are setInterval + fetch) at the cost of per-node fork
 * overhead, an `index.ts` argv-routing branch, and `ELECTRON_RUN_AS_NODE`
 * mode. This module collapses all of that back into the Electron main.
 *
 * Per-datasource isolation can be added later by swapping a Runner
 * implementation for one backed by `worker_threads` or `child_process.fork`
 * — the public manager surface (`start / stop / list`) does not change.
 *
 * URLs are stable for the lifetime of an Electron process: server picks
 * a random loopback port on first `start()`, every datasource gets
 * `http://127.0.0.1:<port>/ds/<id>/`. Across restarts the port changes;
 * the reconciler patches every iframe node's `data.url` on respawn.
 */

import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { app } from "electron";
import { startHttpPoll, type RunnerHandle } from "./runners/http-poll";
import { runTransform } from "./sandbox-runner";
import type { DatasourceSpec, UiSpec } from "./types";

interface Runner {
  id: string;
  spec: DatasourceSpec;
  fetcher: RunnerHandle;
  /** Last shaped value pushed to clients. Undefined until the first
   *  successful fetch + transform. */
  latest: unknown;
  clients: Set<ServerResponse>;
  /** Pre-rendered HTML page served at `/ds/<id>/`. */
  indexHtml: string;
  startedAt: number;
}

function escapeForScriptTag(value: string): string {
  // </script> inside a string literal breaks out of the injected
  // <script> block. The HTML parser only looks for the literal sequence
  // "</script", case-insensitive — escaping the `<` is enough.
  return value.replace(/<\/(script)/gi, "<\\/$1");
}

function buildIndexHtml(ui: UiSpec, endpoint: string): string {
  const userScript = ui.script
    ? `<script>(function(){\n${ui.script}\n})();</script>`
    : "";
  const userCss = ui.css ? `<style>${ui.css}</style>` : "";
  const initScript = `<script>window.__ENDPOINT__ = ${JSON.stringify(escapeForScriptTag(endpoint))};</script>`;
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>datasource</title>
<style>body{margin:0;padding:12px;font:14px/1.4 system-ui,sans-serif;}</style>
${userCss}
</head>
<body>
${ui.html}
${initScript}
${userScript}
</body>
</html>`;
}

const PATH_RE = /^\/ds\/([^/?#]+)(\/[^?#]*)?/;

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
        try {
          r.fetcher.stop();
        } catch {
          // ignore
        }
        for (const c of r.clients) {
          try {
            c.end();
          } catch {
            // ignore
          }
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
    const m = PATH_RE.exec(url);
    if (!m) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
      return;
    }
    const runnerId = decodeURIComponent(m[1]);
    const runner = this.runners.get(runnerId);
    if (!runner) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
      return;
    }
    const sub = m[2] ?? "/";
    if (sub === "/" || sub === "/index.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(runner.indexHtml);
      return;
    }
    if (sub === "/stream") {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
      });
      // Flush headers immediately so the client enters the OPEN state.
      res.write(":ok\n\n");
      if (runner.latest !== undefined) {
        res.write(`data: ${JSON.stringify(runner.latest)}\n\n`);
      }
      runner.clients.add(res);
      req.on("close", () => runner.clients.delete(res));
      return;
    }
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  }

  private buildUrl(id: string): string {
    if (this.serverPort == null) {
      throw new Error("datasource server not yet bound");
    }
    return `http://127.0.0.1:${this.serverPort}/ds/${encodeURIComponent(id)}/`;
  }

  private pushData(runner: Runner, value: unknown): void {
    runner.latest = value;
    const line = `data: ${JSON.stringify(value)}\n\n`;
    for (const client of runner.clients) {
      try {
        client.write(line);
      } catch {
        // close handler will clean the entry up
      }
    }
  }

  private pushError(runner: Runner, err: Error): void {
    const line = `event: error\ndata: ${JSON.stringify({ message: err.message })}\n\n`;
    for (const client of runner.clients) {
      try {
        client.write(line);
      } catch {
        // ignore
      }
    }
  }

  private startFetcher(
    spec: DatasourceSpec,
    runner: Runner,
  ): RunnerHandle {
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
      return startHttpPoll(fetcher, {
        onData: (v) => void onData(v),
        onError,
      });
    }
    // When new fetcher kinds are added, branch them above this point.
    throw new Error(
      `unknown fetcher type: ${JSON.stringify((fetcher as { type?: string }).type)}`,
    );
  }

  async start(id: string, spec: DatasourceSpec): Promise<{ url: string }> {
    this.installShutdownHook();
    await this.stop(id);
    await this.ensureServer();

    const runner: Runner = {
      id,
      spec,
      fetcher: { stop: () => undefined }, // overwritten below
      latest: undefined,
      clients: new Set(),
      indexHtml: buildIndexHtml(
        spec.ui,
        `${this.buildUrl(id)}stream`,
      ),
      startedAt: Date.now(),
    };

    try {
      runner.fetcher = this.startFetcher(spec, runner);
    } catch (err) {
      // Bad fetcher spec — surface synchronously, don't register.
      throw err;
    }

    this.runners.set(id, runner);
    return { url: this.buildUrl(id) };
  }

  async stop(id: string): Promise<void> {
    const r = this.runners.get(id);
    if (!r) return;
    this.runners.delete(id);
    try {
      r.fetcher.stop();
    } catch {
      // ignore
    }
    for (const client of r.clients) {
      try {
        client.end();
      } catch {
        // ignore
      }
    }
  }

  list(): Array<{ id: string; startedAt: number; url: string | null }> {
    return Array.from(this.runners.values()).map((r) => ({
      id: r.id,
      startedAt: r.startedAt,
      url: this.serverPort == null ? null : this.buildUrl(r.id),
    }));
  }
}
