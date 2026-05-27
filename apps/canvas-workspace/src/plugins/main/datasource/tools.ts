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
import type { DatasourceSpec } from "./types";
import type { DataSourceManager } from "./manager";
import { deleteSpec, getSpec, listWorkspaceSpecs, setSpec } from "./store";

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

const ListInputSchema = z.object({}).strict();

const UpdateInputSchema = z
  .object({
    datasourceNodeId: z.string().min(1).max(100),
    patch: z
      .object({
        title: z.string().min(1).max(120).optional(),
        fetcher: FetcherSchema.optional(),
        transform: TransformSchema.optional(),
        ui: UiSchema.optional(),
      })
      .strict()
      .refine(
        (p) =>
          p.title !== undefined ||
          p.fetcher !== undefined ||
          p.transform !== undefined ||
          p.ui !== undefined,
        { message: "patch must include at least one of title/fetcher/transform/ui" },
      ),
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

interface IframeNodeLocation {
  canvas: CanvasSaveData;
  node: CanvasNode;
}

/** Walk the workspace canvas and find the iframe node that owns this
 *  datasourceNodeId. Returns the canvas in-memory along with the node
 *  so the caller can mutate + write back in one pass. */
async function findIframeNodeByDsId(
  workspaceId: string,
  datasourceNodeId: string,
): Promise<IframeNodeLocation | null> {
  const result = await readCanvasFull(workspaceId).catch(() => ({ data: null }));
  const canvas = (result.data as CanvasSaveData | null) ?? null;
  if (!canvas?.nodes) return null;
  for (const node of canvas.nodes) {
    const data = node.data as Record<string, unknown> | undefined;
    if (
      node.type === "iframe" &&
      data?.datasourceNodeId === datasourceNodeId
    ) {
      return { canvas, node };
    }
  }
  return null;
}

/** Mutate an iframe node's title and/or url in place, persist the
 *  canvas, and broadcast. URL changes get a cache-buster query so the
 *  renderer's <webview> actually reloads — same URL would no-op. */
async function patchCanvasIframeNode(
  workspaceId: string,
  location: IframeNodeLocation,
  patch: { title?: string; url?: string },
): Promise<void> {
  const { canvas, node } = location;
  if (patch.title !== undefined) node.title = patch.title;
  if (patch.url !== undefined) {
    const cacheBusted = `${patch.url}${patch.url.includes("?") ? "&" : "?"}v=${Date.now()}`;
    node.data = { ...(node.data ?? {}), url: cacheBusted };
  }
  node.updatedAt = Date.now();
  canvas.savedAt = new Date().toISOString();
  await writeCanvasFull(workspaceId, canvas);
  if (node.id) {
    broadcastCanvasUpdate(workspaceId, [node.id], "update", "datasource-plugin");
  }
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
        "Spec = fetcher + optional transform + ui.\n\n" +
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
        "ui: { html, script?, css? }\n" +
        "  Author the iframe page yourself. `html` is the body markup.\n" +
        "  `script` runs after DOM ready and may use `window.__ENDPOINT__`\n" +
        "  (SSE URL) — typically\n" +
        "  `new EventSource(window.__ENDPOINT__).onmessage = e => { ... }`.\n" +
        "  Each message's data is the JSON-stringified shaped value.\n" +
        "  You may load third-party libs from CDN inside `html` via <script src=...>.\n\n" +
        "Worked example (mock BTC price ticker):\n" +
        "  {\n" +
        "    title: 'BTC (mock)',\n" +
        "    spec: {\n" +
        "      fetcher: { type: 'mock', scenario: 'random_walk', interval: 1000, initial: 50000, volatility: 0.005 },\n" +
        "      transform: { code: \"return { price: input.value, ts: input.ts };\" },\n" +
        "      ui: {\n" +
        "        html: \"<div style='padding:20px;font-family:system-ui'><div style='font-size:11px;color:#666'>BTC/USD</div><div id='p' style='font-size:48px;font-weight:600'>…</div></div>\",\n" +
        "        script: \"new EventSource(window.__ENDPOINT__).onmessage = e => { const d = JSON.parse(e.data); document.getElementById('p').textContent = '$' + d.price.toFixed(2); };\"\n" +
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
          await setSpec(workspaceId, datasourceNodeId, spec as DatasourceSpec);
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
          await deleteSpec(workspaceId, datasourceNodeId).catch(() => undefined);
          return JSON.stringify({
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
    },

    datasource_node_list: {
      name: "datasource_node_list",
      description:
        "List every LIVE data node currently in this workspace. Use as the " +
        "first step before datasource_node_update — natural-language refs " +
        "like 'the BTC node' / 'the last one I added' need a real " +
        "datasourceNodeId to act on. Results include the canvas node id " +
        "(useful for canvas_delete_node) and a summary of each node's " +
        "fetcher so you can disambiguate.\n\n" +
        "Returns JSON `{ ok, nodes: [{ datasourceNodeId, nodeId, title, " +
        "fetcher, hasTransform }] }`. Nodes whose spec exists but whose " +
        "canvas iframe is gone are omitted (the reconciler will GC them).",
      inputSchema: ListInputSchema,
      async execute(): Promise<string> {
        try {
          const specs = await listWorkspaceSpecs(workspaceId);
          const nodes: Array<{
            datasourceNodeId: string;
            nodeId: string | undefined;
            title: string | undefined;
            fetcher: unknown;
            hasTransform: boolean;
          }> = [];
          for (const entry of specs) {
            const location = await findIframeNodeByDsId(
              workspaceId,
              entry.datasourceNodeId,
            );
            if (!location) continue;
            nodes.push({
              datasourceNodeId: entry.datasourceNodeId,
              nodeId: location.node.id,
              title: location.node.title,
              fetcher: entry.persisted.spec.fetcher,
              hasTransform: entry.persisted.spec.transform !== undefined,
            });
          }
          return JSON.stringify({ ok: true, nodes });
        } catch (err) {
          return JSON.stringify({
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
    },

    datasource_node_update: {
      name: "datasource_node_update",
      description:
        "Modify an existing LIVE data node in place — change the title, " +
        "swap the fetcher (e.g. different polling interval / URL), replace " +
        "the transform, or rewrite the UI. Use this instead of delete + " +
        "create when the user says 'change X to Y' on a node that already " +
        "exists.\n\n" +
        "Inputs:\n" +
        "  datasourceNodeId: the id returned by datasource_node_create\n" +
        "                    (NOT the canvas nodeId; the iframe node's\n" +
        "                    data.datasourceNodeId field).\n" +
        "  patch: any subset of { title, fetcher, transform, ui }. Each\n" +
        "         provided field REPLACES the corresponding spec field\n" +
        "         wholesale; omitted fields stay as-is. At least one\n" +
        "         field is required.\n\n" +
        "Behaviour: the runner is restarted with the merged spec, the\n" +
        "persisted spec is rewritten, and the canvas iframe is forced to\n" +
        "reload (the URL gets a cache-buster). Old in-memory state of the\n" +
        "previous runner is lost.\n\n" +
        "Returns JSON `{ ok, datasourceNodeId, nodeId, url }` on success " +
        "or `{ ok: false, error }` on failure.",
      inputSchema: UpdateInputSchema,
      async execute(input: unknown): Promise<string> {
        const parsed = UpdateInputSchema.safeParse(input);
        if (!parsed.success) {
          return JSON.stringify({
            ok: false,
            error: `invalid input: ${parsed.error.message}`,
          });
        }
        const { datasourceNodeId, patch } = parsed.data;

        const persisted = await getSpec(workspaceId, datasourceNodeId);
        if (!persisted) {
          return JSON.stringify({
            ok: false,
            error: `no spec found for datasourceNodeId "${datasourceNodeId}"`,
          });
        }

        const location = await findIframeNodeByDsId(
          workspaceId,
          datasourceNodeId,
        );
        if (!location) {
          return JSON.stringify({
            ok: false,
            error:
              `no canvas iframe node found for datasourceNodeId ` +
              `"${datasourceNodeId}"`,
          });
        }

        // Per-field replacement merge. Omitted fields stay untouched.
        const merged: DatasourceSpec = {
          fetcher: patch.fetcher ?? persisted.spec.fetcher,
          transform:
            patch.transform !== undefined
              ? patch.transform
              : persisted.spec.transform,
          ui: patch.ui ?? persisted.spec.ui,
        };

        try {
          // manager.start internally stops the old runner first; if the
          // new spec is bad, we end up with no runner but the OLD spec
          // still on disk — the 30s reconciler will respawn the old.
          const { url } = await manager.start(datasourceNodeId, merged);
          await setSpec(workspaceId, datasourceNodeId, merged);
          await patchCanvasIframeNode(workspaceId, location, {
            title: patch.title,
            url,
          });
          return JSON.stringify({
            ok: true,
            datasourceNodeId,
            nodeId: location.node.id,
            url,
          });
        } catch (err) {
          return JSON.stringify({
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
    },
  };
}
