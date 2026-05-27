import { describe, expect, it, vi } from "vitest";
import { startMock } from "../runners/mock";

describe("startMock", () => {
  it("counter scenario emits incrementing ticks", async () => {
    const got: Array<{ tick: number; ts: number }> = [];
    const handle = startMock(
      { type: "mock", scenario: "counter", interval: 250 },
      {
        onData: (v) => got.push(v as { tick: number; ts: number }),
        onError: () => undefined,
      },
    );

    await vi.waitFor(() => expect(got.length).toBeGreaterThanOrEqual(2), {
      timeout: 1_000,
    });
    handle.stop();

    expect(got[0].tick).toBe(1);
    expect(got[1].tick).toBe(2);
    expect(got[0].ts).toBeTypeOf("number");
  });

  it("random_walk stays positive and respects volatility bound", async () => {
    const got: Array<{ value: number; ts: number }> = [];
    const handle = startMock(
      {
        type: "mock",
        scenario: "random_walk",
        interval: 250,
        initial: 1000,
        volatility: 0.05,
      },
      {
        onData: (v) => got.push(v as { value: number; ts: number }),
        onError: () => undefined,
      },
    );

    await vi.waitFor(() => expect(got.length).toBeGreaterThanOrEqual(4), {
      timeout: 1_500,
    });
    handle.stop();

    // First sample is the initial value perturbed once by ±5% at most.
    expect(got[0].value).toBeGreaterThan(0);
    expect(got[0].value).toBeGreaterThanOrEqual(950);
    expect(got[0].value).toBeLessThanOrEqual(1050);

    // Series stays strictly positive.
    for (const sample of got) {
      expect(sample.value).toBeGreaterThan(0);
    }
  });

  it("stops emitting after stop()", async () => {
    const got: unknown[] = [];
    const handle = startMock(
      { type: "mock", scenario: "counter", interval: 250 },
      {
        onData: (v) => got.push(v),
        onError: () => undefined,
      },
    );
    // First sample is synchronous.
    expect(got.length).toBe(1);
    handle.stop();
    await new Promise((r) => setTimeout(r, 600));
    expect(got.length).toBe(1);
  });
});
