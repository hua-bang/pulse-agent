/**
 * DynamicAppManager — in-process dynamic-app hosting.
 *
 * One shared loopback HTTP server, one in-memory `Runner` per active
 * dynamic app. Two flavours of runner cover the spec union:
 *
 *   polling  — owns a fetcher loop; payload is the most recent
 *              transformed value. Read-only from the iframe POV.
 *   stateful — owns a state value + a set of LLM-authored action
 *              reducers. Payload is the current state. Mutations
 *              arrive via POST and are serialised through a per-runner
 *              mutex; the new state is persisted to disk and broadcast
 *              to every SSE subscriber.
 *
 * Routes (uniform across kinds):
 *   GET  /api/<id>                   → current payload as JSON
 *   GET  /api/<id>/stream            → SSE of every payload change
 *   POST /api/<id>/actions/<name>    → run action (stateful only),
 *                                       returns new payload (HTTP
 *                                       status codes drive error
 *                                       branches in the iframe)
 *   GET  /ui/<id>                    → iframe page (LLM-authored)
 *
 * iframe page receives three globals:
 *   window.__API__     — snapshot URL (GET)
 *   window.__STREAM__  — SSE URL
 *   window.__ACTIONS__ — { actionName: postUrl, ... } (stateful only)
 */

import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { app } from "electron";
import { startHttpPoll, type RunnerHandle } from "./runners/http-poll";
import { startMock } from "./runners/mock";
import { runAction, runTransform } from "./sandbox-runner";
import {
  deleteState,
  getState,
  setState,
} from "./store";
import type {
  DynamicAppSpec,
  PollingSpec,
  StatefulSpec,
  UiSpec,
} from "./types";
import { stripRequestQuery } from "./utils";

interface BaseRunner {
  id: string;
  workspaceId: string;
  /** Current payload — what /api/<id> returns and what SSE pushes. */
  latest: unknown;
  clients: Set<ServerResponse>;
  indexHtml: string;
  startedAt: number;
}

interface PollingRunner extends BaseRunner {
  kind: "polling";
  spec: PollingSpec;
  fetcher: RunnerHandle;
}

interface StatefulRunner extends BaseRunner {
  kind: "stateful";
  spec: StatefulSpec;
  /** Mutex queue — each POST appends; the chain serialises all action
   *  evaluations against one another. */
  actionsQueue: Promise<void>;
}

type Runner = PollingRunner | StatefulRunner;

function escapeForScriptTag(value: string): string {
  return value.replace(/<\/(script)/gi, "<\\/$1");
}

/** Compose the iframe page. Both kinds share the same scaffolding;
 *  only the injected globals differ. */
function renderUi(args: {
  ui: UiSpec;
  apiUrl: string;
  streamUrl: string;
  actions?: Record<string, string>;
}): string {
  const userScript = args.ui.script
    ? `<script>(function(){\n${args.ui.script}\n})();</script>`
    : "";
  const userCss = args.ui.css ? `<style>${args.ui.css}</style>` : "";
  const actionsLiteral = args.actions
    ? JSON.stringify(args.actions)
    : "undefined";
  const initScript = `<script>
    window.__API__    = ${JSON.stringify(escapeForScriptTag(args.apiUrl))};
    window.__STREAM__ = ${JSON.stringify(escapeForScriptTag(args.streamUrl))};
    window.__ACTIONS__ = ${actionsLiteral};
  </script>`;
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>dynamic app</title>
<style>
  html, body { margin: 0; padding: 0; }
  body { font: 14px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; padding: 12px; }
</style>
${userCss}
</head>
<body>
${args.ui.html}
${initScript}
${userScript}
</body>
</html>`;
}

const UI_RE = /^\/ui\/([^/?#]+)\/?$/;
const API_SNAPSHOT_RE = /^\/api\/([^/?#]+)\/?$/;
const API_STREAM_RE = /^\/api\/([^/?#]+)\/stream\/?$/;
const API_ACTION_RE = /^\/api\/([^/?#]+)\/actions\/([^/?#]+)\/?$/;


const MAX_POST_BODY_BYTES = 1 << 20; // 1 MB

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return await new Promise((resolve, reject) => {
    let length = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      length += chunk.length;
      if (length > MAX_POST_BODY_BYTES) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf-8").trim();
      if (raw.length === 0) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

export class DynamicAppManager {
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
        if (r.kind === "polling") {
          try { r.fetcher.stop(); } catch { /* ignore */ }
        }
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
          reject(new Error("failed to bind dynamic-app server"));
          return;
        }
        this.server = server;
        this.serverPort = addr.port;
        resolve(addr.port);
      });
    });
    return this.serverReady;
  }

  // ─── Request routing ─────────────────────────────────────────────

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const url = stripRequestQuery(req.url ?? "/");

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
      res.write(":ok\n\n");
      if (runner.latest !== undefined) {
        res.write(`data: ${JSON.stringify(runner.latest)}\n\n`);
      }
      runner.clients.add(res);
      req.on("close", () => runner.clients.delete(res));
      return;
    }

    m = API_ACTION_RE.exec(url);
    if (m) {
      if (req.method !== "POST") {
        sendJson(res, 405, { error: "method must be POST" });
        return;
      }
      const runner = this.runners.get(decodeURIComponent(m[1]));
      const actionName = decodeURIComponent(m[2]);
      if (!runner) return this.send404(res);
      if (runner.kind !== "stateful") {
        sendJson(res, 405, {
          error: "dynamic app is not stateful — no actions available",
        });
        return;
      }
      void this.handleAction(runner, actionName, req, res);
      return;
    }

    m = API_SNAPSHOT_RE.exec(url);
    if (m) {
      const runner = this.runners.get(decodeURIComponent(m[1]));
      if (!runner) return this.send404(res);
      sendJson(res, 200, runner.latest ?? null);
      return;
    }

    this.send404(res);
  }

  private send404(res: ServerResponse): void {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  }

  // ─── Action handling ──────────────────────────────────────────────

  private async handleAction(
    runner: StatefulRunner,
    actionName: string,
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const handler = runner.spec.actions[actionName];
    if (!handler) {
      sendJson(res, 404, { error: `unknown action: ${actionName}` });
      return;
    }

    let input: unknown;
    try {
      input = await readJsonBody(req);
    } catch (err) {
      sendJson(res, 400, {
        error: `invalid request body: ${err instanceof Error ? err.message : String(err)}`,
      });
      return;
    }

    // Serialise against other in-flight actions for THIS runner. Each
    // POST chains onto the previous; reads of `runner.latest` happen
    // strictly after the prior mutation has landed.
    const next = runner.actionsQueue.then(async () => {
      try {
        const newState = await runAction(handler.code, runner.latest, input);
        runner.latest = newState;
        await setState(runner.workspaceId, runner.id, newState);
        this.broadcast(runner, newState);
        sendJson(res, 200, newState);
      } catch (err) {
        sendJson(res, 500, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });
    // Swallow rejection so a single action throw doesn't poison the queue.
    runner.actionsQueue = next.catch(() => undefined);
    await next.catch(() => undefined);
  }

  // ─── URL helpers ──────────────────────────────────────────────────

  private buildUiUrl(id: string): string {
    if (this.serverPort == null) {
      throw new Error("dynamic-app server not yet bound");
    }
    return `http://127.0.0.1:${this.serverPort}/ui/${encodeURIComponent(id)}`;
  }

  private buildApiUrl(id: string): string {
    if (this.serverPort == null) {
      throw new Error("dynamic-app server not yet bound");
    }
    return `http://127.0.0.1:${this.serverPort}/api/${encodeURIComponent(id)}`;
  }

  // ─── Broadcast / payload helpers ──────────────────────────────────

  private broadcast(runner: Runner, value: unknown): void {
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

  // ─── Kind-specific startup ────────────────────────────────────────

  private startPollingFetcher(spec: PollingSpec, runner: PollingRunner): RunnerHandle {
    const onData = async (raw: unknown): Promise<void> => {
      try {
        const shaped = spec.transform
          ? await runTransform(spec.transform.code, raw)
          : raw;
        this.broadcast(runner, shaped);
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

  async start(
    workspaceId: string,
    id: string,
    spec: DynamicAppSpec,
  ): Promise<{ url: string }> {
    this.installShutdownHook();
    await this.stop(id);
    await this.ensureServer();

    const apiUrl = this.buildApiUrl(id);
    const streamUrl = `${apiUrl}/stream`;

    if (spec.kind === "polling") {
      const indexHtml = renderUi({
        ui: spec.ui,
        apiUrl,
        streamUrl,
      });
      const runner: PollingRunner = {
        kind: "polling",
        id,
        workspaceId,
        spec,
        fetcher: { stop: () => undefined },
        latest: undefined,
        clients: new Set(),
        indexHtml,
        startedAt: Date.now(),
      };
      runner.fetcher = this.startPollingFetcher(spec, runner);
      this.runners.set(id, runner);
      return { url: this.buildUiUrl(id) };
    }

    // stateful: load persisted state if present, else seed from spec.
    const persisted = await getState(workspaceId, id);
    const initialState =
      persisted !== null ? persisted : spec.state.initial;

    const actions: Record<string, string> = {};
    for (const name of Object.keys(spec.actions)) {
      actions[name] = `${apiUrl}/actions/${encodeURIComponent(name)}`;
    }

    const indexHtml = renderUi({
      ui: spec.ui,
      apiUrl,
      streamUrl,
      actions,
    });

    const runner: StatefulRunner = {
      kind: "stateful",
      id,
      workspaceId,
      spec,
      latest: initialState,
      clients: new Set(),
      indexHtml,
      startedAt: Date.now(),
      actionsQueue: Promise.resolve(),
    };

    // Make sure the seed is on disk so a crash before first action
    // doesn't lose the initial state. setState is a no-op cost-wise
    // for small payloads.
    if (persisted === null) {
      try {
        await setState(workspaceId, id, initialState);
      } catch {
        // best-effort
      }
    }

    this.runners.set(id, runner);
    return { url: this.buildUiUrl(id) };
  }

  async stop(id: string): Promise<void> {
    const r = this.runners.get(id);
    if (!r) return;
    this.runners.delete(id);
    if (r.kind === "polling") {
      try { r.fetcher.stop(); } catch { /* ignore */ }
    }
    for (const client of r.clients) {
      try { client.end(); } catch { /* ignore */ }
    }
  }

  /** Stop the runner AND delete its persisted state file. Use when
   *  the dynamic app is being removed entirely; plain `stop()` is what
   *  you want for restart / update flows where state should survive. */
  async destroy(workspaceId: string, id: string): Promise<void> {
    await this.stop(id);
    await deleteState(workspaceId, id).catch(() => undefined);
  }

  list(): Array<{
    id: string;
    kind: "polling" | "stateful";
    startedAt: number;
    url: string | null;
  }> {
    return Array.from(this.runners.values()).map((r) => ({
      id: r.id,
      kind: r.kind,
      startedAt: r.startedAt,
      url: this.serverPort == null ? null : this.buildUiUrl(r.id),
    }));
  }
}
