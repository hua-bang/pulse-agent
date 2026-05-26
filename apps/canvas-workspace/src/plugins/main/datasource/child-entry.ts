/**
 * Datasource child process entry.
 *
 * One process per active datasource node. Forked by `manager.ts` with
 * `--datasource-child` in argv; the same bundle as the Electron main
 * process, just routed through the conditional in `src/main/index.ts`.
 * Runs as plain Node (parent sets `ELECTRON_RUN_AS_NODE=1`).
 *
 * Responsibilities:
 *   1. Receive a `DatasourceSpec` over IPC.
 *   2. Start the runner that owns the fetch loop / subscription.
 *   3. On every raw value, apply the optional transform via pulse-sandbox
 *      (a separate fork — true isolation for LLM-authored code).
 *   4. Listen on a random localhost port and serve:
 *        - GET /         → an HTML page wrapping the spec's ui that
 *                          subscribes to /stream.
 *        - GET /stream   → text/event-stream of shaped values.
 *   5. Tell the parent the bound port so it can write
 *      `http://localhost:<port>/` into the canvas iframe node.
 */

import http, { type ServerResponse } from "node:http";
import type {
  ChildInitMessage,
  ChildToParentMessage,
  DatasourceSpec,
  UiSpec,
} from "./types";
import { startHttpPoll, type RunnerHandle } from "./runners/http-poll";
import { runTransform } from "./sandbox-runner";

function send(msg: ChildToParentMessage): void {
  if (process.send) process.send(msg);
}

function escapeForScriptTag(value: string): string {
  // Prevent </script> inside string literals from breaking out of the
  // injected <script> block. The HTML parser only looks for the literal
  // sequence "</script", case-insensitive — replacing the `<` is enough.
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

interface ServerState {
  latest: unknown;
  clients: Set<ServerResponse>;
}

function pushToClients(state: ServerState, value: unknown): void {
  state.latest = value;
  const line = `data: ${JSON.stringify(value)}\n\n`;
  for (const client of state.clients) {
    try {
      client.write(line);
    } catch {
      // Connection died mid-write; the 'close' handler will clean up.
    }
  }
}

function pushError(state: ServerState, err: Error): void {
  // Errors travel on the same stream so the UI can render a banner.
  // Distinct event name so well-formed clients can branch; default
  // EventSource onmessage handlers will simply ignore named events.
  const line = `event: error\ndata: ${JSON.stringify({ message: err.message })}\n\n`;
  for (const client of state.clients) {
    try {
      client.write(line);
    } catch {
      // ignore
    }
  }
}

async function startRunner(
  spec: DatasourceSpec,
  state: ServerState,
): Promise<RunnerHandle> {
  const onData = async (raw: unknown): Promise<void> => {
    try {
      const shaped = spec.transform
        ? await runTransform(spec.transform.code, raw)
        : raw;
      pushToClients(state, shaped);
    } catch (err) {
      pushError(state, err instanceof Error ? err : new Error(String(err)));
    }
  };

  const onError = (err: Error): void => {
    pushError(state, err);
  };

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

export async function runChild(): Promise<void> {
  if (!process.send) {
    throw new Error("datasource child started without IPC channel");
  }

  const init = await new Promise<ChildInitMessage>((resolve) => {
    process.once("message", (msg) => resolve(msg as ChildInitMessage));
  });
  const spec = init.spec;

  const state: ServerState = { latest: undefined, clients: new Set() };
  let runner: RunnerHandle | undefined;

  let indexHtml = "";

  const server = http.createServer((req, res) => {
    const url = req.url ?? "/";
    if (url === "/" || url.startsWith("/?") || url === "/index.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(indexHtml);
      return;
    }
    if (url === "/stream") {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
      });
      // Flush headers immediately so EventSource enters the OPEN state.
      res.write(":ok\n\n");
      if (state.latest !== undefined) {
        res.write(`data: ${JSON.stringify(state.latest)}\n\n`);
      }
      state.clients.add(res);
      req.on("close", () => state.clients.delete(res));
      return;
    }
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  });

  // Bind to loopback only — these endpoints are accessed by the Electron
  // renderer in-process. They must NOT be reachable from outside the
  // machine, and not even from other interfaces on the same machine.
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  if (!addr || typeof addr === "string") {
    throw new Error("failed to bind datasource child server");
  }
  const port = addr.port;
  indexHtml = buildIndexHtml(spec.ui, `http://127.0.0.1:${port}/stream`);

  try {
    runner = await startRunner(spec, state);
  } catch (err) {
    send({
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    });
    process.exit(1);
    return;
  }

  send({ type: "ready", port });

  const shutdown = (): void => {
    try {
      runner?.stop();
    } catch {
      // ignore
    }
    server.close(() => process.exit(0));
    // Hard exit if close drags
    setTimeout(() => process.exit(0), 1_000).unref();
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  // If parent dies the IPC channel closes; treat that as a shutdown.
  process.on("disconnect", shutdown);
}
