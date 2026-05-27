/**
 * Canvas-agent tools contributed by the datasource plugin.
 *
 * Surfaces ONE tool for now — `datasource_node_create` — covering the
 * full "user says X → live node appears on canvas" flow:
 *
 *   1. Validate the spec (Zod schema mirrors the JSON shape in
 *      `types.ts`; LLM gets actionable errors back).
 *   2. Fork a child datasource process via `DataSourceManager`.
 *   3. Persist the spec under the canvas plugin store (`plugin:datasource:`
 *      namespace) keyed by `<workspaceId>/<nodeId>` — survives across
 *      relaunches even though the MVP doesn't auto-respawn yet.
 *   4. Append an `iframe` node to the workspace canvas pointing at
 *      `http://127.0.0.1:<port>/`. Reuses the same canvas storage path
 *      that `pinArtifactToCanvas` uses, so the renderer renders it with
 *      its existing iframe-node component — zero renderer changes needed.
 */

import { z } from "zod";
import { randomUUID } from "node:crypto";
import {
  readCanvasFull,
  writeCanvasFull,
  type CanvasNode,
  type CanvasSaveData,
} from "../../../main/canvas/storage";
import { broadcastCanvasUpdate } from "../../../main/canvas/broadcast";
import type { PluginStore } from "../../types";
import type { DatasourceSpec } from "./types";
import type { DataSourceManager } from "./manager";

interface CanvasTool {
  name: string;
  description: string;
  inputSchema: z.ZodType;
  defer_loading?: boolean;
  execute: (input: unknown) => Promise<string>;
}

// ─── Spec schema (matches types.ts) ────────────────────────────────

const HttpPollFetcherSchema = z.object({
  type: z.literal("http_poll"),
  url: z.string().url(),
  interval: z.number().int().positive().min(250).max(60 * 60 * 1000),
  headers: z.record(z.string(), z.string()).optional(),
  method: z.enum(["GET", "POST"]).optional(),
  body: z.unknown().optional(),
});

const MockFetcherSchema = z.object({
  type: z.literal("mock"),
  interval: z.number().int().positive().min(250).max(60 * 60 * 1000),
  scenario: z.enum(["random_walk", "counter"]),
  initial: z.number().optional(),
  volatility: z.number().nonnegative().max(1).optional(),
});

const FetcherSchema = z.discriminatedUnion("type", [
  HttpPollFetcherSchema,
  MockFetcherSchema,
]);

const TransformSchema = z.object({
  code: z.string().min(1).max(20_000),
});

const UiSchema = z.object({
  html: z.string().min(1).max(20_000),
  script: z.string().max(20_000).optional(),
  css: z.string().max(20_000).optional(),
});

const SpecSchema = z.object({
  fetcher: FetcherSchema,
  transform: TransformSchema.optional(),
  ui: UiSchema,
});

const CreateInputSchema = z.object({
  title: z.string().min(1).max(120),
  spec: SpecSchema,
  x: z.number().optional(),
  y: z.number().optional(),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
});

// ─── Canvas helpers ────────────────────────────────────────────────

function autoPlace(nodes: CanvasNode[]): { x: number; y: number } {
  if (nodes.length === 0) return { x: 100, y: 100 };
  let maxRight = 0;
  let bestY = 100;
  for (const n of nodes) {
    const right = (n.x ?? 0) + (n.width ?? 0);
    if (right > maxRight) {
      maxRight = right;
      bestY = n.y ?? 100;
    }
  }
  return { x: maxRight + 40, y: bestY };
}

async function appendIframeNode(
  workspaceId: string,
  url: string,
  title: string,
  datasourceNodeId: string,
  placement: { x?: number; y?: number; width?: number; height?: number },
): Promise<string> {
  const { data } = await readCanvasFull(workspaceId).catch(() => ({ data: null }));
  const canvas: CanvasSaveData = (data as CanvasSaveData | null) ?? {
    nodes: [],
    edges: [],
    transform: { x: 0, y: 0, scale: 1 },
    savedAt: new Date().toISOString(),
  };
  canvas.nodes = canvas.nodes ?? [];

  const pos =
    placement.x != null && placement.y != null
      ? { x: placement.x, y: placement.y }
      : autoPlace(canvas.nodes);

  const nodeId = `node-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const node: CanvasNode = {
    id: nodeId,
    type: "iframe",
    title,
    x: pos.x,
    y: pos.y,
    width: placement.width ?? 520,
    height: placement.height ?? 400,
    data: {
      url,
      mode: "live",
      datasourceNodeId,
    },
    updatedAt: Date.now(),
  };
  canvas.nodes.push(node);
  canvas.savedAt = new Date().toISOString();
  await writeCanvasFull(workspaceId, canvas);
  broadcastCanvasUpdate(workspaceId, [nodeId], "create", "datasource-plugin");
  return nodeId;
}

// ─── Tool factory ──────────────────────────────────────────────────

export function createDatasourceTools(
  workspaceId: string,
  manager: DataSourceManager,
  store: PluginStore,
): Record<string, CanvasTool> {
  return {
    datasource_node_create: {
      name: "datasource_node_create",
      description:
        "Create a LIVE data node on the canvas. The node renders an iframe " +
        "that subscribes (via SSE) to a backing runner in the Electron main " +
        "process; the runner fetches on a schedule and pushes shaped values. " +
        "Use this when the user wants a 'live' / 'real-time' / 'updates " +
        "automatically' view — NOT for static charts (use artifact_* tools).\n\n" +
        "Spec shape:\n" +
        "  fetcher: ONE of:\n" +
        "    { type: 'http_poll', url, interval, headers?, method?, body? }\n" +
        "        Poll a JSON HTTP endpoint. interval is ms, min 250.\n" +
        "    { type: 'mock', scenario, interval, initial?, volatility? }\n" +
        "        Synthetic data for demos / tests (no network). scenario:\n" +
        "          'counter'     → { tick, ts } each interval.\n" +
        "          'random_walk' → { value, ts } following a multiplicative\n" +
        "                          random walk from `initial` (default 100)\n" +
        "                          with per-tick `volatility` (default 0.01).\n" +
        "                          Looks like a stock-price series.\n" +
        "  transform?: { code }\n" +
        "      Function body. `input` global holds the fetched value; must\n" +
        "      `return` the shaped output. NO fetch / require / process /\n" +
        "      Buffer — pure computation only, 1s timeout.\n" +
        "      Example: `return { stars: input.stargazers_count };`\n" +
        "  ui: { html, script?, css? }\n" +
        "      html is body markup. script runs after DOM ready and may use\n" +
        "      `window.__ENDPOINT__` (an SSE URL) — typically\n" +
        "      `new EventSource(window.__ENDPOINT__).onmessage = e => { ... }`.\n" +
        "      Each message's data is the JSON-stringified shaped value.\n\n" +
        "Worked mock example (fake BTC price ticker):\n" +
        "  {\n" +
        "    title: 'BTC (mock)',\n" +
        "    spec: {\n" +
        "      fetcher: { type: 'mock', scenario: 'random_walk', interval: 1000, initial: 50000, volatility: 0.005 },\n" +
        "      transform: { code: \"return { symbol: 'BTC', price: input.value, ts: input.ts };\" },\n" +
        "      ui: {\n" +
        "        html: \"<div>BTC <span id='p'>...</span></div>\",\n" +
        "        script: \"new EventSource(window.__ENDPOINT__).onmessage = e => { const d = JSON.parse(e.data); document.getElementById('p').textContent = d.price.toFixed(2); };\"\n" +
        "      }\n" +
        "    }\n" +
        "  }\n\n" +
        "Returns JSON `{ ok, nodeId, datasourceNodeId, url }` on success or " +
        "`{ ok: false, error }` on failure.",
      inputSchema: CreateInputSchema,
      async execute(input: unknown): Promise<string> {
        const parsed = CreateInputSchema.safeParse(input);
        if (!parsed.success) {
          return JSON.stringify({
            ok: false,
            error: `invalid spec: ${parsed.error.message}`,
          });
        }
        const { title, spec, x, y, width, height } = parsed.data;
        const datasourceNodeId = `ds-${Date.now()}-${randomUUID().slice(0, 8)}`;
        const specKey = `workspace/${workspaceId}/spec/${datasourceNodeId}`;
        try {
          // Order matters for crash-safety: start runner → persist spec
          // → write canvas node. If we crash between spec and node, the
          // reconciler sees a spec without a node and tears down. If we
          // crash before persisting the spec, the in-memory runner dies
          // with the process and nothing leaks. The reconciler also
          // honours a grace window so a mid-create tick does not reap us.
          const { url } = await manager.start(
            datasourceNodeId,
            spec as DatasourceSpec,
          );
          await store.set(specKey, {
            id: datasourceNodeId,
            spec,
            createdAt: Date.now(),
          });
          const nodeId = await appendIframeNode(
            workspaceId,
            url,
            title,
            datasourceNodeId,
            { x, y, width, height },
          );
          return JSON.stringify({
            ok: true,
            nodeId,
            datasourceNodeId,
            url,
          });
        } catch (err) {
          // Best-effort cleanup if any step failed — don't leave a
          // runner attached to a dead spec.
          await manager.stop(datasourceNodeId).catch(() => undefined);
          await store.delete(specKey).catch(() => undefined);
          return JSON.stringify({
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
    },
  };
}
