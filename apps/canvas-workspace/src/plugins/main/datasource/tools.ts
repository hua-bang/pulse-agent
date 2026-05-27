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
import { describeTemplates } from "./templates";

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

const InlineHtmlPresentationSchema = z.object({
  type: z.literal("inline_html"),
  html: z.string().min(1).max(20_000),
  script: z.string().max(20_000).optional(),
  css: z.string().max(20_000).optional(),
});

const TemplatePresentationSchema = z.object({
  type: z.literal("template"),
  template: z.string().min(1).max(60),
  params: z.record(z.string(), z.unknown()),
});

const PresentationSchema = z.discriminatedUnion("type", [
  InlineHtmlPresentationSchema,
  TemplatePresentationSchema,
]);

const SpecSchema = z.object({
  fetcher: FetcherSchema,
  transform: TransformSchema.optional(),
  presentation: PresentationSchema,
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
    // Use the standard `mode: 'url'` shape so the existing iframe-node
    // renderer auto-loads the URL on mount instead of showing its
    // "paste a URL" editor. The `datasourceNodeId` field is how the
    // reconciler / future tools identify nodes we own.
    data: {
      url,
      mode: "url",
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
        "Create a LIVE data node on the canvas. Backed by a runner in the " +
        "Electron main process that fetches on a schedule and publishes " +
        "shaped values; the iframe subscribes via SSE. Use when the user " +
        "wants 'live' / 'real-time' / 'updates automatically' — NOT for " +
        "static charts (use artifact_* tools instead).\n\n" +
        "Spec = fetcher + optional transform + presentation.\n\n" +
        "fetcher: ONE of:\n" +
        "  { type: 'http_poll', url, interval, headers?, method?, body? }\n" +
        "      Poll a JSON HTTP endpoint. interval is ms, min 250.\n" +
        "  { type: 'mock', scenario, interval, initial?, volatility? }\n" +
        "      Synthetic data, no network. scenarios:\n" +
        "        'counter'     → { tick, ts } each interval.\n" +
        "        'random_walk' → { value, ts } multiplicative random walk\n" +
        "                        from `initial` (default 100), per-tick\n" +
        "                        `volatility` (default 0.01). Stock-shaped.\n\n" +
        "transform? (optional, recommended): { code }\n" +
        "  Function body. `input` global holds the raw fetched value; must\n" +
        "  `return` the shaped output. NO fetch / require / process / Buffer.\n" +
        "  Sync only, 1s timeout. Use to rename / pluck fields.\n" +
        "  Example: `return { price: input.value, ts: input.ts };`\n\n" +
        "presentation: ONE of:\n" +
        "  { type: 'template', template, params }\n" +
        "      PREFERRED for common shapes. Pre-built, polished, consistent.\n" +
        "      Available templates:\n" +
        describeTemplates() +
        "\n" +
        "      `params` is template-specific; see each template's schema.\n" +
        "  { type: 'inline_html', html, script?, css? }\n" +
        "      Fallback when no template fits. `script` runs after DOM and\n" +
        "      may use `window.__ENDPOINT__` (SSE URL) — typically\n" +
        "      `new EventSource(window.__ENDPOINT__).onmessage = e => { ... }`.\n\n" +
        "Worked example (template — mock BTC price big number):\n" +
        "  {\n" +
        "    title: 'BTC (mock)',\n" +
        "    spec: {\n" +
        "      fetcher: { type: 'mock', scenario: 'random_walk', interval: 1000, initial: 50000, volatility: 0.005 },\n" +
        "      transform: { code: \"return { price: input.value, ts: input.ts };\" },\n" +
        "      presentation: { type: 'template', template: 'big_number', params: { label: 'BTC/USD', valueField: 'price', format: 'currency' } }\n" +
        "    }\n" +
        "  }\n\n" +
        "Worked example (template — line chart):\n" +
        "  {\n" +
        "    title: 'BTC chart',\n" +
        "    spec: {\n" +
        "      fetcher: { type: 'mock', scenario: 'random_walk', interval: 500, initial: 50000, volatility: 0.003 },\n" +
        "      transform: { code: \"return { price: input.value, ts: input.ts };\" },\n" +
        "      presentation: { type: 'template', template: 'line_chart', params: { title: 'BTC/USD', valueField: 'price', tsField: 'ts', maxPoints: 120 } }\n" +
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
