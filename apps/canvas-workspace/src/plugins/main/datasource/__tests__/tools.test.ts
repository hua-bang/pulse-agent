import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DatasourceSpec } from "../types";
import type { DataSourceManager } from "../manager";

// ─── Mock state ────────────────────────────────────────────────────

const specStore = new Map<string, { id: string; spec: DatasourceSpec; createdAt: number }>();
const canvases = new Map<string, { nodes: any[] }>();
let canvasWrites: Array<{ workspaceId: string; data: unknown }> = [];
let broadcasts: Array<{ workspaceId: string; nodeIds: string[]; kind: string }> = [];

function specKey(ws: string, id: string): string {
  return `${ws}/${id}`;
}

vi.mock("../store", () => ({
  async getSpec(ws: string, id: string) {
    return specStore.get(specKey(ws, id)) ?? null;
  },
  async setSpec(ws: string, id: string, spec: DatasourceSpec) {
    const entry = { version: 1, id, spec, createdAt: Date.now() };
    specStore.set(specKey(ws, id), entry);
    return entry;
  },
  async deleteSpec(ws: string, id: string) {
    specStore.delete(specKey(ws, id));
  },
  async listWorkspaceSpecs(ws: string) {
    return Array.from(specStore.entries())
      .filter(([k]) => k.startsWith(`${ws}/`))
      .map(([k, persisted]) => ({
        workspaceId: ws,
        datasourceNodeId: k.split("/")[1],
        persisted: { ...persisted, version: 1 },
      }));
  },
}));

vi.mock("../../../../main/canvas/storage", () => ({
  readCanvasFull: vi.fn(async (workspaceId: string) => ({
    data: canvases.get(workspaceId) ?? null,
  })),
  writeCanvasFull: vi.fn(async (workspaceId: string, data: unknown) => {
    canvasWrites.push({ workspaceId, data });
    canvases.set(workspaceId, data as { nodes: any[] });
  }),
}));

vi.mock("../../../../main/canvas/broadcast", () => ({
  broadcastCanvasUpdate: vi.fn(
    (workspaceId: string, nodeIds: string[], kind: string) => {
      broadcasts.push({ workspaceId, nodeIds, kind });
    },
  ),
}));

import { createDatasourceTools } from "../tools";

function makeManager(opts: {
  startFails?: boolean;
} = {}): { manager: DataSourceManager; calls: { start: string[]; stop: string[] } } {
  const calls = { start: [] as string[], stop: [] as string[] };
  let counter = 0;
  const running = new Map<string, { id: string; startedAt: number; url: string }>();
  const manager: DataSourceManager = {
    async start(_workspaceId: string, id: string) {
      // Mirror the real manager: start() implicitly stops the existing
      // runner with the same id before booting a new one.
      if (running.has(id)) {
        calls.stop.push(id);
        running.delete(id);
      }
      if (opts.startFails) throw new Error("simulated start failure");
      calls.start.push(id);
      counter += 1;
      const url = `http://127.0.0.1:5000${counter}/ui/${id}`;
      running.set(id, { id, startedAt: Date.now(), url });
      return { url };
    },
    async destroy(_workspaceId: string, id: string) {
      calls.stop.push(id);
      running.delete(id);
    },
    async stop(id: string) {
      calls.stop.push(id);
      running.delete(id);
    },
    list() {
      return Array.from(running.values());
    },
  } as unknown as DataSourceManager;
  return { manager, calls };
}

const WS = "ws-test";

function basicSpec(): DatasourceSpec {
  return {
    kind: "polling",
    fetcher: { type: "mock", scenario: "counter", interval: 1000 },
    transform: { code: "return { tick: input.tick };" },
    ui: { html: "<div id='v'></div>" },
  };
}

function todoSpec(): DatasourceSpec {
  return {
    kind: "stateful",
    state: { initial: [] },
    actions: {
      add: { code: "return [...state, { text: input.text }];" },
    },
    ui: { html: "<div></div>" },
  };
}

beforeEach(() => {
  specStore.clear();
  canvases.clear();
  canvasWrites = [];
  broadcasts = [];
});

describe("datasource_node_create", () => {
  it("starts runner, persists spec, appends iframe node, returns ok", async () => {
    const { manager, calls } = makeManager();
    const tools = createDatasourceTools(WS, manager);

    const res = JSON.parse(
      await tools.datasource_node_create.execute({
        title: "BTC",
        spec: basicSpec(),
      }),
    );

    expect(res.ok).toBe(true);
    expect(res.datasourceNodeId).toMatch(/^ds-/);
    expect(res.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/ui\/ds-/);
    expect(calls.start).toHaveLength(1);

    // spec persisted
    const persisted = Array.from(specStore.values())[0];
    expect(persisted.spec).toEqual(basicSpec());

    // canvas node appended pointing at the runner URL
    const written = canvasWrites.at(-1)!.data as { nodes: any[] };
    const node = written.nodes[0];
    expect(node.type).toBe("iframe");
    expect(node.title).toBe("BTC");
    expect(node.data.url).toBe(res.url);
    expect(node.data.datasourceNodeId).toBe(res.datasourceNodeId);
  });

  it("rolls back persisted spec + runner when manager.start fails", async () => {
    const { manager } = makeManager({ startFails: true });
    const tools = createDatasourceTools(WS, manager);

    const res = JSON.parse(
      await tools.datasource_node_create.execute({
        title: "X",
        spec: basicSpec(),
      }),
    );

    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/simulated start failure/);
    expect(specStore.size).toBe(0);
    expect(canvasWrites).toEqual([]);
  });

  it("rejects an invalid spec via the input schema", async () => {
    const { manager } = makeManager();
    const tools = createDatasourceTools(WS, manager);

    const res = JSON.parse(
      await tools.datasource_node_create.execute({
        title: "X",
        spec: {
          kind: "polling",
          fetcher: { type: "mock", scenario: "no_such_scenario", interval: 1000 },
          ui: { html: "<div></div>" },
        },
      }),
    );

    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/invalid spec/i);
  });
});

describe("datasource_node_update", () => {
  async function seedNode(
    manager: DataSourceManager,
    title = "BTC",
  ): Promise<string> {
    const tools = createDatasourceTools(WS, manager);
    const res = JSON.parse(
      await tools.datasource_node_create.execute({
        title,
        spec: basicSpec(),
      }),
    );
    return res.datasourceNodeId;
  }

  it("merges patch into existing spec, restarts runner, cache-busts URL", async () => {
    const { manager, calls } = makeManager();
    const tools = createDatasourceTools(WS, manager);
    const dsId = await seedNode(manager, "BTC");

    canvasWrites = []; // ignore the create write
    broadcasts = [];
    calls.start.length = 0;
    calls.stop.length = 0;

    const res = JSON.parse(
      await tools.datasource_node_update.execute({
        datasourceNodeId: dsId,
        patch: {
          title: "BTC v2",
          fetcher: { type: "mock", scenario: "counter", interval: 5000 },
        },
      }),
    );

    expect(res.ok).toBe(true);
    expect(calls.stop).toEqual([dsId]); // implicit stop inside start
    expect(calls.start).toEqual([dsId]);

    // Merged spec preserves the un-patched fields and replaces the patched ones.
    const persisted = specStore.get(specKey(WS, dsId))!;
    if (persisted.spec.kind !== "polling") {
      throw new Error("expected polling spec");
    }
    expect(persisted.spec.fetcher).toEqual({
      type: "mock",
      scenario: "counter",
      interval: 5000,
    });
    const original = basicSpec();
    if (original.kind !== "polling") throw new Error("unreachable");
    expect(persisted.spec.transform).toEqual(original.transform);
    expect(persisted.spec.ui).toEqual(original.ui);

    // Canvas node's title is updated and the URL has a cache-buster.
    const written = canvasWrites.at(-1)!.data as { nodes: any[] };
    const node = written.nodes[0];
    expect(node.title).toBe("BTC v2");
    expect(node.data.url).toMatch(/\?v=\d+$/);
    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0].kind).toBe("update");
  });

  it("errors when datasourceNodeId is unknown", async () => {
    const { manager } = makeManager();
    const tools = createDatasourceTools(WS, manager);

    const res = JSON.parse(
      await tools.datasource_node_update.execute({
        datasourceNodeId: "ds-nope",
        patch: { title: "X" },
      }),
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/no spec found/i);
  });

  it("rejects an empty patch", async () => {
    const { manager } = makeManager();
    const tools = createDatasourceTools(WS, manager);
    const dsId = await seedNode(manager);

    const res = JSON.parse(
      await tools.datasource_node_update.execute({
        datasourceNodeId: dsId,
        patch: {},
      }),
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/at least one/i);
  });
});

describe("datasource_node_list", () => {
  it("returns every spec that has a matching canvas node", async () => {
    const { manager } = makeManager();
    const tools = createDatasourceTools(WS, manager);

    await tools.datasource_node_create.execute({
      title: "A",
      spec: basicSpec(),
    });
    await tools.datasource_node_create.execute({
      title: "B",
      spec: basicSpec(),
    });

    const res = JSON.parse(await tools.datasource_node_list.execute({}));
    expect(res.ok).toBe(true);
    expect(res.nodes).toHaveLength(2);
    const titles = res.nodes.map((n: any) => n.title).sort();
    expect(titles).toEqual(["A", "B"]);
    for (const n of res.nodes) {
      expect(n.datasourceNodeId).toMatch(/^ds-/);
      expect(n.nodeId).toMatch(/^node-/);
      expect(n.kind).toBe("polling");
      expect(n.summary).toMatch(/mock every 1000ms/);
    }
  });

  it("skips specs whose canvas node has been deleted", async () => {
    const { manager } = makeManager();
    const tools = createDatasourceTools(WS, manager);
    await tools.datasource_node_create.execute({
      title: "A",
      spec: basicSpec(),
    });

    // Wipe the canvas behind the plugin's back — spec stays orphaned.
    canvases.set(WS, { nodes: [] });

    const res = JSON.parse(await tools.datasource_node_list.execute({}));
    expect(res.ok).toBe(true);
    expect(res.nodes).toEqual([]);
  });

  it("returns empty array when no specs exist", async () => {
    const { manager } = makeManager();
    const tools = createDatasourceTools(WS, manager);
    const res = JSON.parse(await tools.datasource_node_list.execute({}));
    expect(res.ok).toBe(true);
    expect(res.nodes).toEqual([]);
  });
});

describe("stateful create + list", () => {
  it("creates a stateful node and surfaces kind + action summary", async () => {
    const { manager } = makeManager();
    const tools = createDatasourceTools(WS, manager);

    const createRes = JSON.parse(
      await tools.datasource_node_create.execute({
        title: "Todos",
        spec: todoSpec(),
      }),
    );
    expect(createRes.ok).toBe(true);

    const listRes = JSON.parse(await tools.datasource_node_list.execute({}));
    expect(listRes.ok).toBe(true);
    expect(listRes.nodes).toHaveLength(1);
    expect(listRes.nodes[0].kind).toBe("stateful");
    expect(listRes.nodes[0].summary).toMatch(/actions: add/);
  });

  it("rejects update.fetcher patch against a stateful spec", async () => {
    const { manager } = makeManager();
    const tools = createDatasourceTools(WS, manager);

    const created = JSON.parse(
      await tools.datasource_node_create.execute({
        title: "Todos",
        spec: todoSpec(),
      }),
    );

    const res = JSON.parse(
      await tools.datasource_node_update.execute({
        datasourceNodeId: created.datasourceNodeId,
        patch: {
          fetcher: { type: "mock", scenario: "counter", interval: 1000 },
        },
      }),
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/cannot patch.*on a stateful node/i);
  });

  it("rejects update.actions patch against a polling spec", async () => {
    const { manager } = makeManager();
    const tools = createDatasourceTools(WS, manager);

    const created = JSON.parse(
      await tools.datasource_node_create.execute({
        title: "BTC",
        spec: basicSpec(),
      }),
    );

    const res = JSON.parse(
      await tools.datasource_node_update.execute({
        datasourceNodeId: created.datasourceNodeId,
        patch: {
          actions: { add: { code: "return state;" } },
        },
      }),
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/cannot patch.*on a polling node/i);
  });
});
