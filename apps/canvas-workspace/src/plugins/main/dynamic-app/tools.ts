/**
 * Canvas-agent tools contributed by the dynamic-app plugin.
 *
 * Surfaces ONE tool for now — `dynamic_app_create` — covering the
 * full "user says X → live node appears on canvas" flow:
 *
 *   1. Validate the spec (Zod schema mirrors the JSON shape in
 *      `types.ts`; LLM gets actionable errors back).
 *   2. Fork a child runner via `DynamicAppManager`.
 *   3. Persist the spec under the canvas plugin store (`plugin:dynamic-app:`
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
import type { DynamicAppSpec } from "./types";
import type { DynamicAppManager } from "./manager";
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

const ActionSchema = z.object({
  code: z.string().min(1).max(20_000),
});

const UiSchema = z.object({
  html: z.string().min(1).max(20_000),
  script: z.string().max(20_000).optional(),
  css: z.string().max(20_000).optional(),
});

const PollingSpecSchema = z.object({
  kind: z.literal("polling"),
  fetcher: FetcherSchema,
  transform: TransformSchema.optional(),
  ui: UiSchema,
});

const StatefulSpecSchema = z.object({
  kind: z.literal("stateful"),
  state: z.object({ initial: z.unknown() }),
  actions: z.record(z.string().min(1).max(60), ActionSchema),
  ui: UiSchema,
});

const SpecSchema = z.discriminatedUnion("kind", [
  PollingSpecSchema,
  StatefulSpecSchema,
]);

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
    dynamicAppId: z.string().min(1).max(100),
    patch: z
      .object({
        title: z.string().min(1).max(120).optional(),
        // Per-field patches preserve the spec's kind: a polling node
        // stays polling, stateful stays stateful. To convert between
        // kinds, delete + recreate.
        fetcher: FetcherSchema.optional(),
        transform: TransformSchema.optional(),
        actions: z.record(z.string().min(1).max(60), ActionSchema).optional(),
        ui: UiSchema.optional(),
      })
      .strict()
      .refine(
        (p) =>
          p.title !== undefined ||
          p.fetcher !== undefined ||
          p.transform !== undefined ||
          p.actions !== undefined ||
          p.ui !== undefined,
        {
          message:
            "patch must include at least one of title/fetcher/transform/actions/ui",
        },
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
 *  dynamicAppId. Returns the canvas in-memory along with the node
 *  so the caller can mutate + write back in one pass. */
async function findIframeNodeByAppId(
  workspaceId: string,
  dynamicAppId: string,
): Promise<IframeNodeLocation | null> {
  const result = await readCanvasFull(workspaceId).catch(() => ({ data: null }));
  const canvas = (result.data as CanvasSaveData | null) ?? null;
  if (!canvas?.nodes) return null;
  for (const node of canvas.nodes) {
    const data = node.data as Record<string, unknown> | undefined;
    if (
      node.type === "iframe" &&
      data?.dynamicAppId === dynamicAppId
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
    broadcastCanvasUpdate(workspaceId, [node.id], "update", "dynamic-app-plugin");
  }
}

async function appendIframeNode(
  workspaceId: string,
  url: string,
  title: string,
  dynamicAppId: string,
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
    // "paste a URL" editor. The `dynamicAppId` field is how the
    // reconciler / future tools identify nodes we own.
    data: {
      url,
      mode: "url",
      dynamicAppId,
    },
    updatedAt: Date.now(),
  };
  canvas.nodes.push(node);
  canvas.savedAt = new Date().toISOString();
  await writeCanvasFull(workspaceId, canvas);
  broadcastCanvasUpdate(workspaceId, [nodeId], "create", "dynamic-app-plugin");
  return nodeId;
}

// ─── Tool factory ──────────────────────────────────────────────────

export function createDynamicAppTools(
  workspaceId: string,
  manager: DynamicAppManager,
): Record<string, CanvasTool> {
  return {
    dynamic_app_create: {
      name: "dynamic_app_create",
      description:
        "Create a LIVE data node on the canvas. Two kinds, picked via " +
        "`spec.kind`:\n\n" +
        "  'polling'  — pull data from an external source on a schedule.\n" +
        "               Read-only. Use for: prices, status dashboards,\n" +
        "               anything where the data comes from outside.\n" +
        "  'stateful' — owns its own state (todos, notes, counters,\n" +
        "               forms). User interactions mutate it via actions.\n" +
        "               State persists across restarts.\n\n" +
        "iframe globals injected for the LLM-authored ui.script:\n" +
        "  window.__API__     — GET this URL for a snapshot of the current\n" +
        "                       payload (returns JSON).\n" +
        "  window.__STREAM__  — SSE URL; subscribe with\n" +
        "                       `new EventSource(window.__STREAM__)` for\n" +
        "                       push updates whenever the payload changes.\n" +
        "  window.__ACTIONS__ — { actionName: postUrl }. Stateful only.\n" +
        "                       POST JSON body to mutate state.\n\n" +
        "Pick the consumption style by use case: fetch + POST for purely\n" +
        "interactive single-user UIs (TODO, notes); EventSource for live\n" +
        "or multi-window views. Both can be combined.\n\n" +
        "─── POLLING SPEC ───────────────────────────────────────────────\n" +
        "{\n" +
        "  kind: 'polling',\n" +
        "  fetcher: ONE of:\n" +
        "    { type: 'http_poll', url, interval, headers?, method?, body? }\n" +
        "        Poll a JSON HTTP endpoint. interval is ms, min 250.\n" +
        "    { type: 'mock', scenario, interval, initial?, volatility? }\n" +
        "        Synthetic data, no network. scenarios:\n" +
        "          'counter'     → { tick, ts } each interval.\n" +
        "          'random_walk' → { value, ts } multiplicative walk.\n" +
        "  transform?: { code }   // (input) => shapedValue, sync, 1s timeout\n" +
        "  ui: { html, script?, css? }\n" +
        "}\n\n" +
        "─── STATEFUL SPEC ──────────────────────────────────────────────\n" +
        "{\n" +
        "  kind: 'stateful',\n" +
        "  state: { initial: <seed value> },          // any JSON value\n" +
        "  actions: {                                  // RPC reducers\n" +
        "    <name>: { code: '(state, input) => newState body' },\n" +
        "    ...\n" +
        "  },\n" +
        "  ui: { html, script?, css? }\n" +
        "}\n" +
        "Action code rules: function body, has `state` and `input` as\n" +
        "globals, must `return` the new state. Sync only, 1s timeout, no\n" +
        "fetch / require / process. The new state is persisted, broadcast\n" +
        "to SSE clients, and returned in the POST response. POST returns\n" +
        "HTTP 200 on success, 400 on bad input, 500 on action throw.\n\n" +
        "─── Worked examples ─────────────────────────────────────────\n" +
        "polling (mock BTC ticker):\n" +
        "  {\n" +
        "    title: 'BTC (mock)',\n" +
        "    spec: {\n" +
        "      kind: 'polling',\n" +
        "      fetcher: { type: 'mock', scenario: 'random_walk', interval: 1000, initial: 50000, volatility: 0.005 },\n" +
        "      transform: { code: \"return { price: input.value };\" },\n" +
        "      ui: {\n" +
        "        html: \"<div id='p' style='padding:24px;font:48px/1 system-ui'>…</div>\",\n" +
        "        script: \"new EventSource(window.__STREAM__).onmessage = e => { document.getElementById('p').textContent = '$' + JSON.parse(e.data).price.toFixed(2); };\"\n" +
        "      }\n" +
        "    }\n" +
        "  }\n\n" +
        "stateful (TODO):\n" +
        "  {\n" +
        "    title: 'Todos',\n" +
        "    spec: {\n" +
        "      kind: 'stateful',\n" +
        "      state: { initial: [] },\n" +
        "      actions: {\n" +
        "        add:    { code: \"return [...state, { id: Date.now(), text: input.text, done: false }];\" },\n" +
        "        toggle: { code: \"return state.map(t => t.id === input.id ? { ...t, done: !t.done } : t);\" },\n" +
        "        remove: { code: \"return state.filter(t => t.id !== input.id);\" }\n" +
        "      },\n" +
        "      ui: {\n" +
        "        html: \"<input id='i' placeholder='new todo…'><button id='b'>add</button><ul id='l'></ul>\",\n" +
        "        script: \"const A=window.__ACTIONS__; async function call(u,b){return (await fetch(u,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b||{})})).json();} function render(s){l.innerHTML=s.map(t=>`<li><input type=checkbox ${t.done?'checked':''} data-id=${t.id}> ${t.text} <button data-rm=${t.id}>x</button></li>`).join('');} l.onclick=async e=>{if(e.target.matches('[data-id]')){render(await call(A.toggle,{id:+e.target.dataset.id}));}else if(e.target.matches('[data-rm]')){render(await call(A.remove,{id:+e.target.dataset.rm}));}}; b.onclick=async()=>{if(!i.value)return;render(await call(A.add,{text:i.value}));i.value='';}; (async()=>render(await (await fetch(window.__API__)).json()))();\"\n" +
        "      }\n" +
        "    }\n" +
        "  }\n\n" +
        "Returns JSON `{ ok, nodeId, dynamicAppId, url }` on success or " +
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
        const dynamicAppId = `app-${Date.now()}-${randomUUID().slice(0, 8)}`;
        try {
          // Order matters for crash-safety: start runner → persist spec
          // → write canvas node. If we crash between spec and node, the
          // reconciler sees a spec without a node and tears down. If we
          // crash before persisting the spec, the in-memory runner dies
          // with the process and nothing leaks. The reconciler also
          // honours a grace window so a mid-create tick does not reap us.
          const { url } = await manager.start(
            workspaceId,
            dynamicAppId,
            spec as DynamicAppSpec,
          );
          await setSpec(workspaceId, dynamicAppId, spec as DynamicAppSpec);
          const nodeId = await appendIframeNode(
            workspaceId,
            url,
            title,
            dynamicAppId,
            { x, y, width, height },
          );
          return JSON.stringify({
            ok: true,
            nodeId,
            dynamicAppId,
            url,
          });
        } catch (err) {
          // Best-effort cleanup if any step failed — don't leave a
          // runner attached to a dead spec.
          await manager.destroy(workspaceId, dynamicAppId).catch(() => undefined);
          await deleteSpec(workspaceId, dynamicAppId).catch(() => undefined);
          return JSON.stringify({
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
    },

    dynamic_app_list: {
      name: "dynamic_app_list",
      description:
        "List every LIVE data node currently in this workspace. Use as the " +
        "first step before dynamic_app_update — natural-language refs " +
        "like 'the BTC node' / 'the last one I added' need a real " +
        "dynamicAppId to act on.\n\n" +
        "Returns JSON `{ ok, nodes: [{ dynamicAppId, nodeId, title, " +
        "kind, summary }] }`. `kind` is 'polling' | 'stateful'. " +
        "`summary` is a short human-readable hint about what the node " +
        "shows (fetcher type for polling, action names for stateful). " +
        "Nodes whose spec exists but whose canvas iframe is gone are " +
        "omitted (the reconciler will GC them).",
      inputSchema: ListInputSchema,
      async execute(): Promise<string> {
        try {
          const specs = await listWorkspaceSpecs(workspaceId);
          const nodes: Array<{
            dynamicAppId: string;
            nodeId: string | undefined;
            title: string | undefined;
            kind: "polling" | "stateful";
            summary: string;
          }> = [];
          for (const entry of specs) {
            const location = await findIframeNodeByAppId(
              workspaceId,
              entry.dynamicAppId,
            );
            if (!location) continue;
            const spec = entry.persisted.spec;
            const summary =
              spec.kind === "polling"
                ? `${spec.fetcher.type} every ${spec.fetcher.interval}ms` +
                  (spec.transform ? " + transform" : "")
                : `actions: ${Object.keys(spec.actions).join(", ") || "(none)"}`;
            nodes.push({
              dynamicAppId: entry.dynamicAppId,
              nodeId: location.node.id,
              title: location.node.title,
              kind: spec.kind,
              summary,
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

    dynamic_app_update: {
      name: "dynamic_app_update",
      description:
        "Modify an existing LIVE data node in place — change the title, " +
        "swap the fetcher (e.g. different polling interval / URL), replace " +
        "the transform, or rewrite the UI. Use this instead of delete + " +
        "create when the user says 'change X to Y' on a node that already " +
        "exists.\n\n" +
        "Inputs:\n" +
        "  dynamicAppId: the id returned by dynamic_app_create\n" +
        "                    (NOT the canvas nodeId; the iframe node's\n" +
        "                    data.dynamicAppId field).\n" +
        "  patch: any subset of { title, fetcher, transform, ui }. Each\n" +
        "         provided field REPLACES the corresponding spec field\n" +
        "         wholesale; omitted fields stay as-is. At least one\n" +
        "         field is required.\n\n" +
        "Behaviour: the runner is restarted with the merged spec, the\n" +
        "persisted spec is rewritten, and the canvas iframe is forced to\n" +
        "reload (the URL gets a cache-buster). Old in-memory state of the\n" +
        "previous runner is lost.\n\n" +
        "Returns JSON `{ ok, dynamicAppId, nodeId, url }` on success " +
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
        const { dynamicAppId, patch } = parsed.data;

        const persisted = await getSpec(workspaceId, dynamicAppId);
        if (!persisted) {
          return JSON.stringify({
            ok: false,
            error: `no spec found for dynamicAppId "${dynamicAppId}"`,
          });
        }

        const location = await findIframeNodeByAppId(
          workspaceId,
          dynamicAppId,
        );
        if (!location) {
          return JSON.stringify({
            ok: false,
            error:
              `no canvas iframe node found for dynamicAppId ` +
              `"${dynamicAppId}"`,
          });
        }

        // Per-field merge — patch fields replace, omitted stay.
        // Kind-checked so a polling node can't accidentally inherit
        // a `actions` patch and vice versa.
        let merged: DynamicAppSpec;
        if (persisted.spec.kind === "polling") {
          if (patch.actions !== undefined) {
            return JSON.stringify({
              ok: false,
              error:
                "cannot patch `actions` on a polling node. Delete and " +
                "recreate as kind:'stateful' if you want mutation handlers.",
            });
          }
          merged = {
            kind: "polling",
            fetcher: patch.fetcher ?? persisted.spec.fetcher,
            transform:
              patch.transform !== undefined
                ? patch.transform
                : persisted.spec.transform,
            ui: patch.ui ?? persisted.spec.ui,
          };
        } else {
          if (patch.fetcher !== undefined || patch.transform !== undefined) {
            return JSON.stringify({
              ok: false,
              error:
                "cannot patch `fetcher` / `transform` on a stateful node. " +
                "Delete and recreate as kind:'polling' instead.",
            });
          }
          merged = {
            kind: "stateful",
            state: persisted.spec.state,
            actions: patch.actions ?? persisted.spec.actions,
            ui: patch.ui ?? persisted.spec.ui,
          };
        }

        try {
          // manager.start internally stops the old runner first; if the
          // new spec is bad, we end up with no runner but the OLD spec
          // still on disk — the 30s reconciler will respawn the old.
          // stateful state file is left in place across the restart;
          // only spec.actions / spec.ui changes.
          const { url } = await manager.start(workspaceId, dynamicAppId, merged);
          await setSpec(workspaceId, dynamicAppId, merged);
          await patchCanvasIframeNode(workspaceId, location, {
            title: patch.title,
            url,
          });
          return JSON.stringify({
            ok: true,
            dynamicAppId,
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
