import { describe, expect, it } from "vitest";
import { withUtf8Locale } from "./pty-locale";

describe("withUtf8Locale", () => {
  it("adds a UTF-8 LANG when a GUI launch left the locale unset", () => {
    expect(withUtf8Locale({ PATH: "/bin" }, "darwin")).toEqual({ PATH: "/bin", LANG: "en_US.UTF-8" });
    expect(withUtf8Locale({ PATH: "/bin" }, "linux")).toEqual({ PATH: "/bin", LANG: "C.UTF-8" });
  });

  it("keeps any locale the user already chose", () => {
    expect(withUtf8Locale({ LANG: "zh_CN.UTF-8" }, "darwin")).toEqual({ LANG: "zh_CN.UTF-8" });
    expect(withUtf8Locale({ LC_CTYPE: "UTF-8" }, "darwin")).toEqual({ LC_CTYPE: "UTF-8" });
    expect(withUtf8Locale({ LC_ALL: "C" }, "linux")).toEqual({ LC_ALL: "C" });
  });

  it("leaves Windows alone", () => {
    expect(withUtf8Locale({}, "win32")).toEqual({});
  });
});
