import { describe, expect, it } from "vitest";
import { runTransform } from "../sandbox-runner";

describe("runTransform", () => {
  it("returns the shaped value", async () => {
    const out = await runTransform(
      "return { stars: input.stargazers_count };",
      { stargazers_count: 42 },
    );
    expect(out).toEqual({ stars: 42 });
  });

  it("exposes JSON / Math / Date", async () => {
    const out = await runTransform(
      "return { sum: input.xs.reduce((a, b) => a + b, 0), pi: Math.PI };",
      { xs: [1, 2, 3] },
    );
    expect(out).toEqual({ sum: 6, pi: Math.PI });
  });

  it("does NOT expose fetch / require / process / Buffer", async () => {
    const probes = [
      "return typeof fetch;",
      "return typeof require;",
      "return typeof process;",
      "return typeof Buffer;",
      "return typeof setTimeout;",
    ];
    for (const code of probes) {
      const out = await runTransform(code, null);
      expect(out).toBe("undefined");
    }
  });

  it("rejects eval / new Function via codeGeneration: false", async () => {
    await expect(runTransform("return eval('1+1');", null)).rejects.toThrow(
      /transform failed/i,
    );
    await expect(
      runTransform("return new Function('return 1')();", null),
    ).rejects.toThrow(/transform failed/i);
  });

  it("kills sync infinite loops via vm timeout", async () => {
    await expect(
      runTransform("while (true) {}", null),
    ).rejects.toThrow(/transform failed/i);
  });

  it("propagates runtime errors as transform failures", async () => {
    await expect(
      runTransform("return input.deeply.nested.thing;", { deeply: null }),
    ).rejects.toThrow(/transform failed/i);
  });

  it("rejects empty / overlong code", async () => {
    await expect(runTransform("", null)).rejects.toThrow(/non-empty/);
    await expect(runTransform("a".repeat(30_000), null)).rejects.toThrow(
      /exceeds/,
    );
  });
});
