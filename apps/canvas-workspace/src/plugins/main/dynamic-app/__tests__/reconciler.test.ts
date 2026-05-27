import { beforeEach, describe, expect, it, vi } from "vitest";

// Test-mutable mocks. Holders are reassigned in beforeEach; the
// vi.mock factories below close over them via getter.
let specs: Array<{
  workspaceId: string;
  dynamicAppId: string;
  persisted: {
    version: number;
    id: string;
    spec: { fetcher: unknown; ui: unknown };
    createdAt: number;
  };
}> = [];
let deletedSpecs: Array<{ workspaceId: string; id: string }> = [];

const canvases = new Map<string, { nodes: unknown[] }>();
let canvasWrites: Array<{ workspaceId: string; data: unknown }> = [];
let broadcasts: Array<{ workspaceId: string; nodeIds: string[]; kind: string }> = [];

vi.mock("../store", () => ({
  listAllSpecs: vi.fn(async () => specs),
  deleteSpec: vi.fn(async (workspaceId: string, id: string) => {
    deletedSpecs.push({ workspaceId, id });
    specs = specs.filter(
      (s) => !(s.workspaceId === workspaceId && s.dynamicAppId === id),
    );
  }),
}));

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
import type { DynamicAppManager } from "../manager";

function makeManager(opts: {
  running?: Array<{ id: string; startedAt: number }>;
} = {}): { manager: DynamicAppManager; calls: { start: string[]; stop: string[] } } {
  const calls = { start: [] as string[], stop: [] as string[] };
  const running = new Map(
    (opts.running ?? []).map((i) => [
      i.id,
      { id: i.id, startedAt: i.startedAt, url: `http://127.0.0.1:9999/ui/${i.id}` },
    ]),
  );
  const manager: DynamicAppManager = {
    async start(_workspaceId: string, id: string) {
      calls.start.push(id);
      const port = 20_000 + calls.start.length;
      const url = `http://127.0.0.1:${port}/ui/${encodeURIComponent(id)}`;
      running.set(id, { id, startedAt: Date.now(), url });
      return { url };
    },
    async stop(id: string) {
      calls.stop.push(id);
      running.delete(id);
    },
    list() {
      return Array.from(running.values());
    },
  } as unknown as DynamicAppManager;
  return { manager, calls };
}

const SPEC = {
  kind: "polling" as const,
  fetcher: { type: "http_poll", url: "http://x.test/", interval: 500 },
  ui: { html: "<div></div>" },
};

function persistedFor(id: string): {
  version: number;
  id: string;
  spec: typeof SPEC;
  createdAt: number;
} {
  return { version: 1, id, spec: SPEC, createdAt: 0 };
}

beforeEach(() => {
  specs = [];
  deletedSpecs = [];
  canvases.clear();
  canvasWrites = [];
  broadcasts = [];
});

describe("reconcileOnce", () => {
  it("respawns a child for a persisted spec whose canvas node still exists", async () => {
    specs = [
      { workspaceId: "ws1", dynamicAppId: "ds-1", persisted: persistedFor("ds-1") },
    ];
    canvases.set("ws1", {
      nodes: [
        {
          id: "node-a",
          type: "iframe",
          data: {
            url: "http://127.0.0.1:1/ui/ds-1",
            dynamicAppId: "ds-1",
          },
        },
      ],
    });
    const { manager, calls } = makeManager();

    await reconcileOnce(manager);

    expect(calls.start).toEqual(["ds-1"]);
    expect(calls.stop).toEqual([]);
    // Node URL was patched with the fresh URL.
    expect(canvasWrites).toHaveLength(1);
    const writtenNode = (
      canvasWrites[0].data as { nodes: Array<{ data: { url: string } }> }
    ).nodes[0];
    expect(writtenNode.data.url).toMatch(
      /^http:\/\/127\.0\.0\.1:\d+\/ui\/[^/]+$/,
    );
    expect(broadcasts).toEqual([
      { workspaceId: "ws1", nodeIds: ["node-a"], kind: "update" },
    ]);
  });

  it("deletes an orphan spec when no canvas node references it", async () => {
    specs = [
      { workspaceId: "ws1", dynamicAppId: "ds-orphan", persisted: persistedFor("ds-orphan") },
    ];
    canvases.set("ws1", { nodes: [] });
    const { manager, calls } = makeManager();

    await reconcileOnce(manager);

    expect(deletedSpecs).toEqual([{ workspaceId: "ws1", id: "ds-orphan" }]);
    expect(calls.start).toEqual([]);
    expect(calls.stop).toEqual([]);
  });

  it("stops orphan running children whose spec has disappeared", async () => {
    const { manager, calls } = makeManager({
      running: [{ id: "ds-stale", startedAt: 0 }],
    });

    await reconcileOnce(manager);

    expect(calls.stop).toEqual(["ds-stale"]);
  });

  it("does NOT reap children inside the create grace window", async () => {
    const { manager, calls } = makeManager({
      running: [{ id: "ds-fresh", startedAt: Date.now() - 1 }],
    });

    await reconcileOnce(manager);

    expect(calls.stop).toEqual([]);
  });

  it("leaves spec+node+running children alone", async () => {
    specs = [
      { workspaceId: "ws1", dynamicAppId: "ds-1", persisted: persistedFor("ds-1") },
    ];
    canvases.set("ws1", {
      nodes: [
        {
          id: "node-a",
          type: "iframe",
          data: { url: "http://127.0.0.1:1/ui/ds-1", dynamicAppId: "ds-1" },
        },
      ],
    });
    const { manager, calls } = makeManager({
      running: [{ id: "ds-1", startedAt: Date.now() - 60_000 }],
    });

    await reconcileOnce(manager);

    expect(calls.start).toEqual([]);
    expect(calls.stop).toEqual([]);
    expect(canvasWrites).toEqual([]);
  });
});
