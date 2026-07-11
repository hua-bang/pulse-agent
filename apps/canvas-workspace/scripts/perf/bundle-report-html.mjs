/**
 * Self-contained HTML dashboard for the bundle report. No external assets;
 * light/dark via prefers-color-scheme. Chart styling follows the repo-neutral
 * dataviz conventions: single-hue magnitude bars, thin marks with rounded
 * data-ends, ink-token text, recessive chrome, per-mark hover tooltips.
 */

const esc = (value) =>
  String(value).replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));

const fmt = (n) => n.toLocaleString('en-US');
const fmtGate = (value) => (value === null || value === undefined ? '—' : typeof value === 'boolean' ? String(value) : fmt(value));

export const renderBundleReportHtml = (report) => {
  const { metrics, gates, probes, topChunks, commit, generatedAt } = report;
  const maxKB = topChunks[0]?.rawKB ?? 1;
  const allPass = gates.every((gate) => gate.pass);

  const tiles = [
    { label: 'Entry chunk (raw)', value: `${fmt(metrics.entryRawKB)} KB`, note: 'eagerly parsed at startup' },
    { label: 'Entry chunk (gzip)', value: `${fmt(metrics.entryGzipKB)} KB`, note: 'compressed size' },
    ...(metrics.startupJsRawKB === undefined ? [] : [
      { label: 'Startup JS closure', value: `${fmt(metrics.startupJsRawKB)} KB`, note: `${metrics.startupRequestCount} static JS/CSS requests` },
      { label: 'Startup CSS closure', value: `${fmt(metrics.startupCssRawKB)} KB`, note: `${fmt(metrics.startupCssGzipKB)} KB gzip` },
    ]),
    { label: 'Total JS', value: `${fmt(metrics.totalJsKB)} KB`, note: `${metrics.chunkCount} chunks` },
    ...(metrics.totalCssRawKB === undefined ? [] : [
      { label: 'Total CSS', value: `${fmt(metrics.totalCssRawKB)} KB`, note: 'all renderer CSS' },
    ]),
    {
      label: 'Gate status',
      value: allPass ? 'PASS' : 'FAIL',
      note: allPass ? 'all bundle policies pass' : 'bundle policy failed',
      status: allPass ? 'good' : 'critical',
    },
  ];

  const tileHtml = tiles.map((tile) => `
    <div class="tile">
      <div class="tile-label">${esc(tile.label)}</div>
      <div class="tile-value${tile.status ? ` status-${tile.status}` : ''}">${
        tile.status ? `<span class="status-icon">${tile.status === 'good' ? '✓' : '✗'}</span>` : ''
      }${esc(tile.value)}</div>
      <div class="tile-note">${esc(tile.note)}</div>
    </div>`).join('');

  const barsHtml = topChunks.map((chunk) => {
    const isEntry = chunk.name.startsWith('index-');
    const pct = Math.max(1, Math.round((chunk.rawKB / maxKB) * 100));
    const shortName = chunk.name.replace(/-[\w-]{8,}\.js$/, '');
    return `
    <div class="bar-row" data-tip="${esc(chunk.name)} — ${fmt(chunk.rawKB)} KB raw${isEntry ? ' (entry, eagerly parsed)' : ' (lazy chunk)'}">
      <div class="bar-name">${esc(shortName)}${isEntry ? '<span class="bar-tag">entry</span>' : ''}</div>
      <div class="bar-track"><div class="bar-fill${isEntry ? ' bar-fill-entry' : ''}" style="width:${pct}%"></div></div>
      <div class="bar-value">${fmt(chunk.rawKB)}</div>
    </div>`;
  }).join('');

  const gateRows = gates.map((gate) => `
    <tr>
      <td>${esc(gate.metric)}</td>
      <td class="num">${fmtGate(gate.baseline)}</td>
      <td class="num">${fmtGate(gate.limit)}</td>
      <td class="num">${fmtGate(gate.current)}</td>
      <td class="num">${gate.deltaPct === null ? '—' : `${gate.deltaPct > 0 ? '+' : ''}${gate.deltaPct}%`}</td>
      <td class="${gate.pass ? 'status-good' : 'status-critical'}"><span class="status-icon">${gate.pass ? '✓' : '✗'}</span>${gate.pass ? 'PASS' : 'FAIL'}</td>
    </tr>`).join('');

  const probeRows = probes.map((probe) => `
    <tr>
      <td>${esc(probe.lib)}</td>
      <td>${probe.inEntry
        ? '<span class="muted">in entry chunk</span>'
        : '<span class="status-good"><span class="status-icon">✓</span>split out</span>'}</td>
    </tr>`).join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pulse Canvas bundle report</title>
<style>
  :root {
    --surface: #fcfcfb; --page: #f9f9f7;
    --ink: #0b0b0b; --ink-2: #52514e; --muted: #898781;
    --grid: #e1e0d9; --border: rgba(11,11,11,0.10);
    --bar: #86b6ef; --bar-entry: #2a78d6;
    --good: #0ca30c; --critical: #d03b3b;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --surface: #1a1a19; --page: #0d0d0d;
      --ink: #ffffff; --ink-2: #c3c2b7; --muted: #898781;
      --grid: #2c2c2a; --border: rgba(255,255,255,0.10);
      --bar: #184f95; --bar-entry: #3987e5;
      --good: #0ca30c; --critical: #d03b3b;
    }
  }
  * { box-sizing: border-box; margin: 0; }
  body { background: var(--page); color: var(--ink); font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; padding: 24px; }
  .wrap { max-width: 880px; margin: 0 auto; display: grid; gap: 16px; }
  h1 { font-size: 18px; }
  .meta { color: var(--muted); font-size: 12px; }
  .card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 16px; }
  h2 { font-size: 13px; color: var(--ink-2); font-weight: 600; margin-bottom: 12px; }
  .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; }
  .tile { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 14px 16px; }
  .tile-label { font-size: 12px; color: var(--ink-2); }
  .tile-value { font-size: 24px; font-weight: 650; margin: 2px 0; }
  .tile-note { font-size: 11px; color: var(--muted); }
  .bar-row { display: grid; grid-template-columns: 220px 1fr 64px; gap: 10px; align-items: center; padding: 3px 0; position: relative; }
  .bar-name { font-size: 12px; color: var(--ink-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: right; }
  .bar-tag { margin-left: 6px; font-size: 10px; color: var(--muted); border: 1px solid var(--grid); border-radius: 4px; padding: 0 4px; }
  .bar-track { height: 14px; border-left: 1px solid var(--grid); }
  .bar-fill { height: 12px; margin-top: 1px; background: var(--bar); border-radius: 0 4px 4px 0; }
  .bar-fill-entry { background: var(--bar-entry); }
  .bar-value { font-size: 12px; color: var(--ink-2); font-variant-numeric: tabular-nums; }
  .bar-row:hover::after { content: attr(data-tip); position: absolute; left: 230px; top: -26px; z-index: 2; background: var(--ink); color: var(--surface); font-size: 11px; padding: 3px 8px; border-radius: 6px; white-space: nowrap; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; color: var(--muted); font-weight: 500; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; }
  th, td { padding: 6px 10px 6px 0; border-bottom: 1px solid var(--grid); }
  tr:last-child td { border-bottom: none; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  th.num { text-align: right; }
  .status-good { color: var(--good); font-weight: 600; }
  .status-critical { color: var(--critical); font-weight: 600; }
  .status-icon { margin-right: 4px; }
  .muted { color: var(--muted); }
  .foot { font-size: 11px; color: var(--muted); }
</style>
</head>
<body>
<div class="wrap">
  <div>
    <h1>Pulse Canvas · renderer bundle report</h1>
    <div class="meta">commit ${esc(commit)} · generated ${esc(generatedAt)} · Electron loads from file://, so cost = main-thread parse/eval, not download</div>
  </div>
  <div class="tiles">${tileHtml}</div>
  <div class="card">
    <h2>Top chunks by raw size (KB) — entry is parsed at startup, the rest load on demand</h2>
    ${barsHtml}
  </div>
  <div class="card">
    <h2>Bundle gates (perf/baselines.json policies)</h2>
    <table>
      <thead><tr><th>Metric</th><th class="num">Baseline</th><th class="num">Limit</th><th class="num">Current</th><th class="num">Δ</th><th>Status</th></tr></thead>
      <tbody>${gateRows}</tbody>
    </table>
  </div>
  <div class="card">
    <h2>Heavy libraries in the entry chunk (heuristic string probes, informational)</h2>
    <table><tbody>${probeRows}</tbody></table>
  </div>
  <div class="foot">Regenerate: <code>pnpm --filter canvas-workspace build &amp;&amp; pnpm --filter canvas-workspace perf:bundle</code>. When a fix lowers a metric, lower its baseline in the same PR.</div>
</div>
</body>
</html>`;
};
