// Renders a self-contained, human-friendly HTML dashboard from the aggregated
// perf snapshot. Pure string building — no deps, no build step. Opens in any
// browser; this is a dev artifact and never ships in the app.

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const fmtBytes = (n) => {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
};

// Parse "computeParentContainerMap @ n=2000" → { fn, n }.
const parseBench = (name) => {
  const m = /^(.*?)\s*@\s*n=(\d+)\s*$/.exec(name || '');
  if (m) return { fn: m[1], n: Number(m[2]) };
  return { fn: name || '?', n: null };
};

const bars = (rows, valueOf, label) =>
  rows
    .map((r) => {
      const max = Math.max(...rows.map(valueOf), 1);
      const pct = (valueOf(r) / max) * 100;
      return `<div class="bar-row"><span class="bar-label">${esc(label(r))}</span>
        <span class="bar-track"><span class="bar-fill" style="width:${pct.toFixed(1)}%"></span></span>
        <span class="bar-val">${esc(fmtBytes(valueOf(r)))}</span></div>`;
    })
    .join('\n');

const benchSection = (benches) => {
  if (!benches?.length) return '<p class="muted">L2 未运行。</p>';
  // group by function, collect (n, mean)
  const byFn = new Map();
  for (const b of benches) {
    const { fn, n } = parseBench(b.name);
    if (n == null || b.mean == null) continue;
    if (!byFn.has(fn)) byFn.set(fn, []);
    byFn.get(fn).push({ n, mean: b.mean });
  }
  const rows = [];
  for (const [fn, pts] of byFn) {
    pts.sort((a, b) => a.n - b.n);
    const ns = pts.map((p) => p.n);
    const cells = pts.map((p) => `<td>${p.mean.toFixed(4)}</td>`).join('');
    // growth exponent across the largest interval: time ∝ n^k
    let verdict = '—';
    if (pts.length >= 2) {
      const a = pts[pts.length - 2];
      const b = pts[pts.length - 1];
      const k = Math.log(b.mean / a.mean) / Math.log(b.n / a.n);
      const cls = k >= 1.6 ? 'bad' : k >= 1.25 ? 'warn' : 'good';
      const label = k >= 1.6 ? '≈ 二次' : k >= 1.25 ? '超线性' : '≈ 线性';
      verdict = `<span class="tag ${cls}">n^${k.toFixed(2)} · ${label}</span>`;
    }
    rows.push({ fn, ns, cells, verdict });
  }
  const allN = [...new Set(benches.map((b) => parseBench(b.name).n).filter(Boolean))].sort((a, b) => a - b);
  const head = allN.map((n) => `<th>n=${n} (ms)</th>`).join('');
  return `<table class="grid"><thead><tr><th>函数</th>${head}<th>增长</th></tr></thead><tbody>
    ${rows.map((r) => `<tr><td class="mono">${esc(r.fn)}</td>${r.cells}<td>${r.verdict}</td></tr>`).join('\n')}
  </tbody></table>
  <p class="muted">增长 = 最大两档 n 之间的拟合指数。n^1≈线性,n^2≈二次(暴露 O(n²) 热点)。</p>`;
};

const bundleSection = (bundle) => {
  if (!bundle) return '<p class="muted">L1 未运行。</p>';
  const deps = Object.entries(bundle.heavyDepInEntry || {})
    .map(
      ([d, inEntry]) =>
        `<span class="tag ${inEntry ? 'bad' : 'good'}">${esc(d)} ${inEntry ? '· eager' : '· split'}</span>`,
    )
    .join(' ');
  const top = (bundle.chunks || []).slice(0, 10);
  return `
    <div class="big">启动 chunk <span class="mono">${esc(bundle.entryChunk)}</span> ·
      gzip <strong>${fmtBytes(bundle.entryGzipBytes)}</strong> / raw ${fmtBytes(bundle.entryRawBytes)}</div>
    <div class="muted">总计 gzip ${fmtBytes(bundle.totalGzipBytes)} · ${bundle.chunkCount} chunk(${bundle.asyncChunkCount} async)</div>
    <h3>重依赖是否在启动 chunk</h3><div class="tags">${deps}</div>
    <h3>Top chunks (gzip)</h3><div class="bars">${bars(top, (c) => c.gzipBytes, (c) => c.name)}</div>
    <p class="muted">逐模块占比见同目录 <a href="bundle-treemap.html">bundle-treemap.html</a>(需 PULSE_PERF_BUNDLE=1 构建生成)。</p>`;
};

const runtimeSection = (runtime) => {
  if (!runtime?.scenarios?.length) return '<p class="muted">L4 未运行(需 harness perf-runtime)。</p>';
  const rows = runtime.scenarios
    .map(
      (s) =>
        `<tr><td class="mono">${esc(s.scenario)}</td><td>${s.fps}</td><td>${s.frameMsP95}</td>
         <td>${s.frameMsMax}</td><td>${s.longTasks}</td>
         <td>${s.heapStartMB != null && s.heapEndMB != null ? (s.heapEndMB - s.heapStartMB).toFixed(1) : '—'}</td></tr>`,
    )
    .join('\n');
  return `<table class="grid"><thead><tr><th>场景</th><th>fps</th><th>帧 p95</th><th>帧 max</th><th>long tasks</th><th>堆Δ MB</th></tr></thead><tbody>${rows}</tbody></table>`;
};

const statusBadges = (steps) =>
  (steps || [])
    .map((s) => `<span class="tag ${s.status === 'ok' ? 'good' : s.status === 'skipped' ? 'mut' : 'bad'}">${esc(s.label)}: ${esc(s.status)}</span>`)
    .join(' ');

export function renderDashboard(snapshot) {
  const { generatedAt, steps, bundle, benches, runtime } = snapshot;
  return `<!doctype html><html lang="zh"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Canvas Workspace 性能快照</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; background:#f4f4f6; color:#1c1c1e; font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif; }
  .wrap { max-width: 960px; margin: 28px auto; padding: 0 20px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h2 { font-size: 15px; margin: 28px 0 10px; }
  h3 { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color:#8e8e93; margin: 16px 0 8px; }
  .card { background:#fff; border:1px solid #e3e3e6; border-radius:12px; padding:18px 20px; box-shadow:0 6px 24px rgba(0,0,0,.05); }
  .big { font-size: 16px; }
  .muted { color:#8e8e93; font-size:12px; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .tags { display:flex; flex-wrap:wrap; gap:6px; }
  .tag { display:inline-block; padding:2px 8px; border-radius:999px; font-size:11px; font-weight:600; }
  .tag.good { background:#e3f6e8; color:#1b7f3b; } .tag.bad { background:#fde7e7; color:#c0392b; }
  .tag.warn { background:#fff4e0; color:#b8761a; } .tag.mut, .tag.mut { background:#ececef; color:#8e8e93; }
  table.grid { width:100%; border-collapse:collapse; font-variant-numeric:tabular-nums; margin-top:6px; }
  .grid th, .grid td { text-align:left; padding:6px 10px; border-bottom:1px solid #ececef; }
  .grid th { color:#8e8e93; font-weight:500; font-size:12px; }
  .bars { display:flex; flex-direction:column; gap:5px; }
  .bar-row { display:grid; grid-template-columns: 230px 1fr 90px; align-items:center; gap:10px; font-size:12px; }
  .bar-label { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .bar-track { background:#ececef; border-radius:4px; height:14px; overflow:hidden; }
  .bar-fill { display:block; height:100%; background:linear-gradient(90deg,#5b8def,#7aa7ff); }
  .bar-val { text-align:right; color:#48484a; }
  a { color:#2c6ecb; }
</style></head>
<body><div class="wrap">
  <h1>Canvas Workspace 性能快照</h1>
  <div class="muted">生成于 ${esc(generatedAt || '')} · <span class="tags" style="display:inline-flex">${statusBadges(steps)}</span></div>

  <h2>一、前端资源 (bundle)</h2><div class="card">${bundleSection(bundle)}</div>
  <h2>二、热函数微基准 (算法成本)</h2><div class="card">${benchSection(benches)}</div>
  <h2>三、运行时 profiling</h2><div class="card">${runtimeSection(runtime)}</div>

  <p class="muted" style="margin-top:24px">对应发现见 <span class="mono">docs/performance-analysis-consolidated.md</span> · 启动相位在应用内 Perf 面板查看(PULSE_PERF=1)。</p>
</div></body></html>`;
}
