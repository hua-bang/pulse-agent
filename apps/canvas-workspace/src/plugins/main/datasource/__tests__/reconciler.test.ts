import { beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock factories must be hoist-safe: they cannot capture test-file
// constants. We expose mutable holders via getters on the mocked module
// and rebind them inside `beforeEach`.
const canvases = new Map<string, { nodes: unknown[] }>();
let canvasWrites: Array<{ workspaceId: string; data: unknown }> = [];
let broadcasts: Array<{ workspaceId: string; nodeIds: string[]; kind: string }> = [];

vi.mock("../../../../main/canvas/storage", () => ({
  readCanvasFull: vi.fn(async (workspaceId: string) => ({
    data: canvases.get(workspaceId) ?? null,
  })),
  writeCanvasFull: vi.fn(async (workspaceId: string, data: unknown) => {
    canvasWrites.push({ workspaceId, data });
    canvases.set(workspaceId, data as { nodes: unknown[] });
  }),
}));

vi.mock("../../../../main/canvas/broadcast", () => ({
  broadcastCanvasUpdate: vi.fn(
    (workspaceId: string, nodeIds: string[], kind: string) => {
      broadcasts.push({ workspaceId, nodeIds, kind });
    },
  ),
}));

import { reconcileOnce } from "../reconciler";
import type { DataSourceManager } from "../manager";
import type { PluginStore } from "../../../types";

function makeStore(): PluginStore & { readonly data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    async get<T>(key: string): Promise<T | undefined> {
      return data.get(key) as T | undefined;
    },
    async set<T>(key: string, value: T): Promise<void> {
      data.set(key, value);
    },
    async delete(key: string): Promise<void> {
      data.delete(key);
    },
    async list(prefix?: string): Promise<string[]> {
      return Array.from(data.keys()).filter((k) =>
        prefix ? k.startsWith(prefix) : true,
      );
    },
  };
}

function makeManager(opts: {
  running?: Array<{ id: string; startedAt: number }>;
} = {}): { manager: DataSourceManager; calls: { start: string[]; stop: string[] } } {
  const calls = { start: [] as string[], stop: [] as string[] };
  const running = new Map(
    (opts.running ?? []).map((i, idx) => [
      i.id,
      { id: i.id, port: 10_000 + idx, pid: 1000 + idx, startedAt: i.startedAt },
    ]),
  );
  const manager: DataSourceManager = {
    async start(id: string) {
      calls.start.push(id);
      const port = 20_000 + calls.start.length;
      running.set(id, { id, port, pid: 5000, startedAt: Date.now() });
      return { port };
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

const SPEC = {
  fetcher: { type: "http_poll", url: "http://x.test/", interval: 500 },
  ui: { html: "<div></div>" },
};

beforeEach(() => {
  canvases.clear();
  canvasWrites = [];
  broadcasts = [];
});

describe("reconcileOnce", () => {
  it("respawns a child for a persisted spec whose canvas node still exists", async () => {
    const store = makeStore();
    await store.set("workspace/ws1/spec/ds-1", {
      id: "ds-1",
      spec: SPEC,
      createdAt: 0,
    });
    canvases.set("ws1", {
      nodes: [
        {
          id: "node-a",
          type: "iframe",
          data: {
            url: "http://127.0.0.1:1/",
            mode: "live",
            datasourceNodeId: "ds-1",
          },
        },
      ],
    });
    const { manager, calls } = makeManager();

    await reconcileOnce(manager, store);

    expect(calls.start).toEqual(["ds-1"]);
    expect(calls.stop).toEqual([]);
    // Node URL was patched with the fresh port.
    expect(canvasWrites).toHaveLength(1);
    const writtenNode = (
      canvasWrites[0].data as { nodes: Array<{ data: { url: string } }> }
    ).nodes[0];
    expect(writtenNode.data.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    expect(broadcasts).toEqual([
      { workspaceId: "ws1", nodeIds: ["node-a"], kind: "update" },
    ]);
  });

  it("deletes an orphan spec when no canvas node references it", async () => {
    const store = makeStore();
    await store.set("workspace/ws1/spec/ds-orphan", {
      id: "ds-orphan",
      spec: SPEC,
      createdAt: 0,
    });
    canvases.set("ws1", { nodes: [] });
    const { manager, calls } = makeManager();

    await reconcileOnce(manager, store);

    expect(await store.list("workspace/")).toEqual([]);
    expect(calls.start).toEqual([]);
    expect(calls.stop).toEqual([]);
  });

  it("stops orphan running children whose spec has disappeared", async () => {
    const store = makeStore();
    const { manager, calls } = makeManager({
      running: [{ id: "ds-stale", startedAt: 0 }],
    });

    await reconcileOnce(manager, store);

    expect(calls.stop).toEqual(["ds-stale"]);
  });

  it("does NOT reap children inside the create grace window", async () => {
    const store = makeStore();
    const { manager, calls } = makeManager({
      // started 1ms ago — well inside the 10s grace
      running: [{ id: "ds-fresh", startedAt: Date.now() - 1 }],
    });

    await reconcileOnce(manager, store);

    expect(calls.stop).toEqual([]);
  });

  it("leaves spec+node+running children alone", async () => {
    const store = makeStore();
    await store.set("workspace/ws1/spec/ds-1", {
      id: "ds-1",
      spec: SPEC,
      createdAt: 0,
    });
    canvases.set("ws1", {
      nodes: [
        {
          id: "node-a",
          type: "iframe",
          data: {
            url: "http://127.0.0.1:1/",
            mode: "live",
            datasourceNodeId: "ds-1",
          },
        },
      ],
    });
    const { manager, calls } = makeManager({
      running: [{ id: "ds-1", startedAt: Date.now() - 60_000 }],
    });

    await reconcileOnce(manager, store);

    expect(calls.start).toEqual([]);
    expect(calls.stop).toEqual([]);
    expect(canvasWrites).toEqual([]);
  });
});
