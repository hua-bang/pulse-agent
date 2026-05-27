import { describe, expect, it } from "vitest";
import { runAction, runTransform } from "../sandbox-runner";

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

describe("runAction", () => {
  it("returns the new state computed from (state, input)", async () => {
    const out = await runAction(
      "return [...state, { text: input.text }];",
      [{ text: "old" }],
      { text: "new" },
    );
    expect(out).toEqual([{ text: "old" }, { text: "new" }]);
  });

  it("exposes both state and input as globals; nothing else", async () => {
    const probes = [
      ["return typeof state;", "object"],
      ["return typeof input;", "object"],
      ["return typeof fetch;", "undefined"],
      ["return typeof require;", "undefined"],
      ["return typeof process;", "undefined"],
    ];
    for (const [code, expected] of probes) {
      expect(await runAction(code, [], {})).toBe(expected);
    }
  });

  it("propagates runtime errors as 'action failed'", async () => {
    await expect(
      runAction("return state.deeply.nested;", { deeply: null }, {}),
    ).rejects.toThrow(/action failed/i);
  });

  it("kills sync infinite loops via vm timeout", async () => {
    await expect(runAction("while (true) {}", null, null)).rejects.toThrow(
      /action failed/i,
    );
  });
});
