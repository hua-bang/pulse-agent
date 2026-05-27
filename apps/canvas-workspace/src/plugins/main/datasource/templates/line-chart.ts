import { z } from "zod";
import {
  escapeHtml,
  wrapDocument,
  type TemplateDefinition,
} from "./types";

const ParamsSchema = z.object({
  /** Chart title shown above the plot. */
  title: z.string().min(1).max(80),
  /** Key in the shaped JSON to read the y value from. */
  valueField: z.string().min(1).max(60),
  /** Optional key for the timestamp (epoch ms). Default: receive time. */
  tsField: z.string().min(1).max(60).optional(),
  /** Max points kept on chart; oldest scroll off. Default 120. */
  maxPoints: z.number().int().min(10).max(2_000).optional(),
  /** Y-axis label. */
  yLabel: z.string().max(40).optional(),
});

type Params = z.infer<typeof ParamsSchema>;

// uPlot — tiny (~30KB), fast, zero dependencies. CDN-loaded so the
// template stays a single self-contained HTML doc.
const UPLOT_CSS = "https://cdn.jsdelivr.net/npm/uplot@1.6.30/dist/uPlot.min.css";
const UPLOT_JS = "https://cdn.jsdelivr.net/npm/uplot@1.6.30/dist/uPlot.iife.min.js";

export const lineChartTemplate: TemplateDefinition<Params> = {
  id: "line_chart",
  description:
    "Scrolling line chart driven by a single numeric field. New samples " +
    "push onto the right; oldest scroll off at `maxPoints`. Uses uPlot " +
    "(loaded from CDN, ~30KB).",
  paramsSchema: ParamsSchema,
  render(params, ctx) {
    const maxPoints = params.maxPoints ?? 120;

    const body = `
<div class="head">
  <div class="title">${escapeHtml(params.title)}</div>
  <div class="last" id="last">…</div>
</div>
<div id="chart"></div>
<script>
(function () {
  var valueField = ${JSON.stringify(params.valueField)};
  var tsField    = ${JSON.stringify(params.tsField ?? null)};
  var maxPoints  = ${JSON.stringify(maxPoints)};
  var yLabel     = ${JSON.stringify(params.yLabel ?? "")};

  var xs = [];
  var ys = [];
  var lastEl = document.getElementById('last');
  var chartEl = document.getElementById('chart');

  function makeOpts() {
    return {
      width: chartEl.clientWidth || 400,
      height: chartEl.clientHeight || 240,
      cursor: { drag: { x: false, y: false } },
      legend: { show: false },
      scales: { x: { time: true } },
      axes: [
        { stroke: '#57606a' },
        { stroke: '#57606a', label: yLabel || undefined },
      ],
      series: [
        {},
        { stroke: '#0969da', width: 2, points: { show: false } },
      ],
    };
  }

  var plot;
  function ensurePlot() {
    if (plot) return;
    if (typeof uPlot === 'undefined') return;
    plot = new uPlot(makeOpts(), [xs, ys], chartEl);
  }

  window.addEventListener('resize', function () {
    if (plot) plot.setSize({ width: chartEl.clientWidth, height: chartEl.clientHeight });
  });

  var pendingValues = [];
  function flush() {
    ensurePlot();
    if (!plot) { return; }
    if (pendingValues.length === 0) return;
    for (var i = 0; i < pendingValues.length; i++) {
      var sample = pendingValues[i];
      xs.push(sample[0]);
      ys.push(sample[1]);
    }
    pendingValues.length = 0;
    while (xs.length > maxPoints) { xs.shift(); ys.shift(); }
    plot.setData([xs, ys]);
  }

  var es = new EventSource(${JSON.stringify(`${ctx.dsUrl}/stream`)});
  es.onmessage = function (e) {
    try {
      var data = JSON.parse(e.data);
      var v = data[valueField];
      if (typeof v !== 'number' || !isFinite(v)) return;
      var ts = tsField && typeof data[tsField] === 'number' ? data[tsField] : Date.now();
      pendingValues.push([Math.floor(ts / 1000), v]);
      lastEl.textContent = v.toLocaleString();
      flush();
    } catch (err) {
      lastEl.textContent = 'parse error';
    }
  };
  es.addEventListener('error', function (e) {
    try { var data = JSON.parse(e.data); lastEl.textContent = data.message || 'error'; } catch {}
  });
})();
</script>`;

    return wrapDocument({
      title: params.title,
      externalCss: [UPLOT_CSS],
      externalScripts: [UPLOT_JS],
      bodyCss: `
        .head { display: flex; align-items: baseline; justify-content: space-between; padding: 10px 14px 4px; }
        .title { font-size: 13px; font-weight: 600; color: #1f2328; }
        .last { font-size: 13px; color: #57606a; font-variant-numeric: tabular-nums; }
        #chart { width: 100%; height: calc(100vh - 40px); padding: 0 8px 8px; box-sizing: border-box; }
        .u-legend { display: none; }
      `,
      body,
    });
  },
};
