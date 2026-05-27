import { z } from "zod";
import {
  escapeHtml,
  wrapDocument,
  type TemplateDefinition,
} from "./types";

const ParamsSchema = z.object({
  /** Label shown above the number. */
  label: z.string().min(1).max(60),
  /** Key in the shaped JSON to read the value from. */
  valueField: z.string().min(1).max(60),
  /** Optional preset formatting; default 'number'. */
  format: z.enum(["number", "currency", "percent"]).optional(),
  /** Decimal places (default 2 for currency/percent, 0 for number). */
  decimals: z.number().int().min(0).max(10).optional(),
  /** Show ▲/▼ delta vs the previous value? Default true. */
  showDelta: z.boolean().optional(),
});

type Params = z.infer<typeof ParamsSchema>;

export const bigNumberTemplate: TemplateDefinition<Params> = {
  id: "big_number",
  description:
    "A single large numeric readout with an optional ▲/▼ delta vs the " +
    "previous tick. Best for prices, counters, single-metric KPIs.",
  paramsSchema: ParamsSchema,
  render(params, ctx) {
    const showDelta = params.showDelta ?? true;
    const format = params.format ?? "number";
    const decimals =
      params.decimals ?? (format === "currency" || format === "percent" ? 2 : 0);

    const body = `
<div class="wrap">
  <div class="label">${escapeHtml(params.label)}</div>
  <div class="value" id="v">…</div>
  ${showDelta ? `<div class="delta" id="d"></div>` : ""}
</div>
<script>
(function () {
  var valueField = ${JSON.stringify(params.valueField)};
  var format = ${JSON.stringify(format)};
  var decimals = ${JSON.stringify(decimals)};
  var showDelta = ${JSON.stringify(showDelta)};
  var prev = null;
  var vEl = document.getElementById('v');
  var dEl = document.getElementById('d');

  function fmt(n) {
    if (typeof n !== 'number' || !isFinite(n)) return String(n);
    if (format === 'currency') return '$' + n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    if (format === 'percent')  return (n * 100).toFixed(decimals) + '%';
    return n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  }

  function apply(value) {
    vEl.textContent = fmt(value);
    if (!showDelta || !dEl) return;
    if (prev !== null && typeof value === 'number' && typeof prev === 'number') {
      var diff = value - prev;
      var pct = prev !== 0 ? (diff / prev) * 100 : 0;
      var sign = diff >= 0 ? '▲ +' : '▼ ';
      dEl.textContent = sign + fmt(Math.abs(diff)) + ' (' + pct.toFixed(2) + '%)';
      dEl.className = 'delta ' + (diff >= 0 ? 'up' : diff < 0 ? 'down' : '');
    }
    if (typeof value === 'number') prev = value;
  }

  var es = new EventSource(${JSON.stringify(`${ctx.dsUrl}/stream`)});
  es.onmessage = function (e) {
    try {
      var data = JSON.parse(e.data);
      apply(data[valueField]);
    } catch (err) {
      vEl.textContent = 'parse error';
    }
  };
  es.addEventListener('error', function (e) {
    try { var data = JSON.parse(e.data); vEl.textContent = data.message || 'error'; } catch {}
  });
})();
</script>`;

    return wrapDocument({
      title: params.label,
      bodyCss: `
        .wrap { padding: 20px; display: flex; flex-direction: column; gap: 8px; }
        .label { font-size: 11px; color: #57606a; text-transform: uppercase; letter-spacing: 0.6px; font-weight: 600; }
        .value { font-size: 48px; font-weight: 600; font-variant-numeric: tabular-nums; line-height: 1; }
        .delta { font-size: 13px; font-variant-numeric: tabular-nums; color: #57606a; }
        .delta.up { color: #1a7f37; }
        .delta.down { color: #cf222e; }
      `,
      body,
    });
  },
};
