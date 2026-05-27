import { describe, expect, it } from "vitest";
import {
  describeTemplates,
  escapeHtml,
  getTemplate,
  templateRegistry,
} from "..";

const CTX = { dsUrl: "http://127.0.0.1:1234/api/ds-x" };

describe("template registry", () => {
  it("exposes the built-in templates", () => {
    expect(Object.keys(templateRegistry).sort()).toEqual([
      "big_number",
      "line_chart",
    ]);
  });

  it("getTemplate throws for unknown ids with a useful message", () => {
    expect(() => getTemplate("nope")).toThrow(/unknown template "nope"/);
    expect(() => getTemplate("nope")).toThrow(/big_number/);
  });

  it("describeTemplates returns one line per template", () => {
    const desc = describeTemplates();
    expect(desc).toContain("big_number");
    expect(desc).toContain("line_chart");
  });
});

describe("escapeHtml", () => {
  it("escapes &<>\"' for safe interpolation", () => {
    expect(escapeHtml(`<a href="x">&'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;",
    );
  });
});

describe("big_number template", () => {
  const tpl = getTemplate("big_number");

  it("renders with required params and references the SSE endpoint", () => {
    const html = tpl.render(
      { label: "BTC/USD", valueField: "price", format: "currency" },
      CTX,
    );
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("BTC/USD");
    expect(html).toContain('"price"'); // valueField inlined
    expect(html).toContain('"currency"');
    expect(html).toContain(`new EventSource(\"http://127.0.0.1:1234/api/ds-x/stream\")`);
  });

  it("html-escapes the label to prevent injection via params", () => {
    const html = tpl.render(
      {
        label: "<script>alert('xss')</script>",
        valueField: "price",
      },
      CTX,
    );
    expect(html).not.toMatch(/<script>alert\('xss'\)<\/script>/);
    expect(html).toContain("&lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt;");
  });

  it("rejects unknown / out-of-range params via paramsSchema", () => {
    const res = tpl.paramsSchema.safeParse({
      label: "",
      valueField: "x",
    });
    expect(res.success).toBe(false);
  });
});

describe("line_chart template", () => {
  const tpl = getTemplate("line_chart");

  it("renders with required params and pulls in uPlot from CDN", () => {
    const html = tpl.render(
      {
        title: "BTC Price",
        valueField: "price",
        tsField: "ts",
        maxPoints: 60,
      },
      CTX,
    );
    expect(html).toContain("BTC Price");
    expect(html).toContain("uPlot");
    expect(html).toContain("uplot@1.6.30");
    expect(html).toContain('"price"');
    expect(html).toContain('"ts"');
    expect(html).toContain(`new EventSource(\"http://127.0.0.1:1234/api/ds-x/stream\")`);
  });

  it("validates maxPoints range", () => {
    const tooFew = tpl.paramsSchema.safeParse({
      title: "x",
      valueField: "y",
      maxPoints: 1,
    });
    expect(tooFew.success).toBe(false);

    const tooMany = tpl.paramsSchema.safeParse({
      title: "x",
      valueField: "y",
      maxPoints: 100_000,
    });
    expect(tooMany.success).toBe(false);
  });
});
