import { describe, expect, it } from "vitest";
import { stripRequestQuery } from "../utils";

describe("stripRequestQuery", () => {
  it("returns the path unchanged when no query or hash is present", () => {
    expect(stripRequestQuery("/ui/app-x")).toBe("/ui/app-x");
    expect(stripRequestQuery("/api/app-x/stream")).toBe("/api/app-x/stream");
    expect(stripRequestQuery("/")).toBe("/");
  });

  it("drops `?query` (regression for the update cache-buster)", () => {
    expect(stripRequestQuery("/ui/app-x?v=123")).toBe("/ui/app-x");
    expect(stripRequestQuery("/ui/app-x?v=123&foo=bar")).toBe("/ui/app-x");
    expect(stripRequestQuery("/api/app-x/stream?token=abc")).toBe(
      "/api/app-x/stream",
    );
  });

  it("drops `#fragment`", () => {
    expect(stripRequestQuery("/ui/app-x#section")).toBe("/ui/app-x");
  });

  it("drops both, picking whichever comes first", () => {
    expect(stripRequestQuery("/ui/app-x?v=1#section")).toBe("/ui/app-x");
    expect(stripRequestQuery("/ui/app-x#section?v=1")).toBe("/ui/app-x");
  });
});
