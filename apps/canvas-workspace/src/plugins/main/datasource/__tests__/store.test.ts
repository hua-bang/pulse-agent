import { mkdtempSync, rmSync } from "node:fs";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Redirect STORE_DIR + getWorkspaceDir to a per-test tmp directory.
// Hoist-safe holder; we mutate it in beforeEach.
let TMP_ROOT = "/will-be-set-in-beforeEach";

vi.mock("../../../../main/canvas/storage", () => ({
  get STORE_DIR() {
    return TMP_ROOT;
  },
  getWorkspaceDir: (id: string) => join(TMP_ROOT, id),
}));

import {
  deleteSpec,
  getSpec,
  listAllSpecs,
  listWorkspaceSpecs,
  setSpec,
} from "../store";

const SAMPLE_SPEC = {
  kind: "polling" as const,
  fetcher: { type: "mock" as const, scenario: "counter" as const, interval: 1000 },
  ui: { html: "<div></div>" },
};

beforeEach(() => {
  TMP_ROOT = mkdtempSync(join(tmpdir(), "ds-store-test-"));
});

afterEach(() => {
  rmSync(TMP_ROOT, { recursive: true, force: true });
});

describe("datasource store", () => {
  it("set + get round-trip", async () => {
    await setSpec("ws1", "ds-a", SAMPLE_SPEC, 12345);
    const out = await getSpec("ws1", "ds-a");
    expect(out).toMatchObject({
      version: 1,
      id: "ds-a",
      spec: SAMPLE_SPEC,
      createdAt: 12345,
    });
  });

  it("getSpec returns null when the spec doesn't exist", async () => {
    expect(await getSpec("ws1", "missing")).toBeNull();
  });

  it("delete removes the file; subsequent get returns null", async () => {
    await setSpec("ws1", "ds-a", SAMPLE_SPEC);
    await deleteSpec("ws1", "ds-a");
    expect(await getSpec("ws1", "ds-a")).toBeNull();
  });

  it("delete on a missing spec is a no-op", async () => {
    await expect(deleteSpec("ws1", "nope")).resolves.toBeUndefined();
  });

  it("rejects invalid characters in the datasource id", async () => {
    await expect(setSpec("ws1", "../escape", SAMPLE_SPEC)).rejects.toThrow(
      /invalid datasource id/,
    );
  });

  it("listWorkspaceSpecs returns only that workspace's specs", async () => {
    await setSpec("ws1", "ds-a", SAMPLE_SPEC);
    await setSpec("ws1", "ds-b", SAMPLE_SPEC);
    await setSpec("ws2", "ds-c", SAMPLE_SPEC);
    const ws1 = await listWorkspaceSpecs("ws1");
    expect(ws1.map((s) => s.datasourceNodeId).sort()).toEqual(["ds-a", "ds-b"]);
  });

  it("listAllSpecs walks every workspace dir", async () => {
    await setSpec("ws1", "ds-a", SAMPLE_SPEC);
    await setSpec("ws2", "ds-b", SAMPLE_SPEC);
    const all = await listAllSpecs();
    expect(
      all
        .map((s) => `${s.workspaceId}/${s.datasourceNodeId}`)
        .sort(),
    ).toEqual(["ws1/ds-a", "ws2/ds-b"]);
  });

  it("listAllSpecs skips manifest-style dirs (start with __)", async () => {
    await setSpec("ws1", "ds-a", SAMPLE_SPEC);
    // Drop a stray __workspaces__ directory like the canvas store uses.
    await fs.mkdir(join(TMP_ROOT, "__workspaces__"), { recursive: true });
    const all = await listAllSpecs();
    expect(all.map((s) => s.workspaceId)).toEqual(["ws1"]);
  });

  it("writes specs to the expected on-disk path under the workspace dir", async () => {
    await setSpec("ws1", "ds-a", SAMPLE_SPEC);
    const path = join(TMP_ROOT, "ws1", "datasources", "ds-a.json");
    const raw = await fs.readFile(path, "utf-8");
    expect(JSON.parse(raw)).toMatchObject({ id: "ds-a", spec: SAMPLE_SPEC });
  });
});
