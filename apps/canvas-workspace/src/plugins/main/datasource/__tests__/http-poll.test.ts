import { afterEach, describe, expect, it, vi } from "vitest";
import { startHttpPoll } from "../runners/http-poll";

describe("startHttpPoll", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("emits parsed JSON on each tick and stops cleanly", async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls += 1;
      return new Response(JSON.stringify({ n: calls }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const received: unknown[] = [];
    const errors: Error[] = [];
    const handle = startHttpPoll(
      { type: "http_poll", url: "http://example.test/", interval: 250 },
      {
        onData: (v) => received.push(v),
        onError: (e) => errors.push(e),
      },
    );

    // Wait for the immediate first call to land.
    await vi.waitFor(() => expect(received.length).toBeGreaterThan(0), {
      timeout: 1000,
    });
    handle.stop();

    expect(received[0]).toEqual({ n: 1 });
    expect(errors).toEqual([]);
  });

  it("reports non-2xx as an error and keeps polling", async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response("nope", { status: 500, statusText: "boom" });
    }) as typeof fetch;

    const errors: Error[] = [];
    const handle = startHttpPoll(
      { type: "http_poll", url: "http://example.test/", interval: 250 },
      {
        onData: () => undefined,
        onError: (e) => errors.push(e),
      },
    );

    await vi.waitFor(() => expect(errors.length).toBeGreaterThan(0), {
      timeout: 1000,
    });
    handle.stop();

    expect(errors[0].message).toContain("500");
  });

  it("clamps too-low intervals up to the floor", async () => {
    // 50ms requested → floor of 250ms enforced. We don't assert the timer
    // value directly (it's internal); instead we confirm a single tick
    // happens within a generous window, plus exactly one extra tick has
    // landed by ~270ms (well under what 50ms × many would produce).
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls += 1;
      return new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const handle = startHttpPoll(
      { type: "http_poll", url: "http://example.test/", interval: 50 },
      {
        onData: () => undefined,
        onError: () => undefined,
      },
    );

    await vi.waitFor(() => expect(calls).toBeGreaterThan(0), { timeout: 500 });
    // After ~270ms total we should have at most ~2 ticks; nothing close
    // to the ~5+ that a 50ms interval would produce.
    await new Promise((r) => setTimeout(r, 270));
    handle.stop();
    expect(calls).toBeLessThanOrEqual(3);
  });
});
