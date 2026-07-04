/**
 * Renderer for the six-aspect performance dashboard. Pure function of
 * (dictionary, snapshot, bundleReport) → self-contained HTML with light/dark
 * themes and tabbed navigation. Chart styling follows the repo-neutral
 * dataviz conventions (single-hue bars, ink-token text, status color + icon).
 */

const esc = (value) =>
  String(value).replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));

const fmt = (n) => (typeof n === 'number' ? n.toLocaleString('en-US') : String(n));

const aspectHealth = (aspect, metricsOf, valueOf) => {
  const defs = metricsOf(aspect.id);
  const measured = defs.filter((d) => valueOf(d.id) !== undefined);
  if (measured.length === 0) return 'muted';
  const gatesFail = measured.some((d) => valueOf(d.id)?.pass === false);
  if (gatesFail) return 'critical';
  return measured.length === defs.length ? 'good' : 'warn';
};

const valueCell = (def, entry) => {
  if (!entry) {
    return `<span class="muted">${def.instrumented ? '已埋待采' : '未建'}</span>`;
  }
  if (def.unit === 'bool') {
    return entry.value
      ? '<span class="status-good">✓ 保持</span>'
      : '<span class="status-critical">✗ 被破坏</span>';
  }
  return `<b>${fmt(entry.value)}</b><span class="unit"> ${esc(def.unit)}</span>`;
};

const gateCell = (def, entry) => {
  if (def.level !== 'gate') return `<span class="muted">${esc(def.level)}</span>`;
  if (!entry || entry.pass === undefined) return '<span class="muted">gate · 待数据</span>';
  const limit = entry.limit !== undefined ? ` ≤ ${fmt(entry.limit)}` : '';
  return entry.pass
    ? `<span class="status-good">✓ PASS${limit}</span>`
    : `<span class="status-critical">✗ FAIL${limit}</span>`;
};

export const renderDashboardHtml = (dictionary, snapshot, bundleReport) => {
  const byId = new Map(snapshot.metrics.map((m) => [m.id, m]));
  const valueOf = (id) => byId.get(id);
  const metricsOf = (aspectId) => dictionary.metrics.filter((m) => m.aspect === aspectId);

  const gated = dictionary.metrics.filter((m) => m.level === 'gate');
  const gatedMeasured = gated.map((m) => valueOf(m.id)).filter((e) => e && e.pass !== undefined);
  const gatesPass = gatedMeasured.filter((e) => e.pass).length;
  const measuredCount = dictionary.metrics.filter((m) => valueOf(m.id) !== undefined).length;

  const tabs = dictionary.aspects.map((a) => {
    const health = aspectHealth(a, metricsOf, valueOf);
    return `<button class="tab" role="tab" id="tab-${a.id}" aria-selected="false" data-panel="${a.id}"><span class="dot dot-${health}"></span>${esc(a.name)}</button>`;
  }).join('');

  const healthTiles = dictionary.aspects.map((a) => {
    const health = aspectHealth(a, metricsOf, valueOf);
    const star = dictionary.metrics.find((m) => m.id === a.northStar);
    const entry = star ? valueOf(star.id) : undefined;
    const value = entry
      ? (star.unit === 'bool'
        ? (entry.value ? '✓' : '✗')
        : `${fmt(entry.value)}<span class="unit"> ${esc(star.unit)}</span>`)
      : `<span class="empty">${star?.instrumented ? '已埋待采' : '未建'}</span>`;
    return `<button class="h-tile" data-goto="${a.id}">
      <span class="h-name">${esc(a.name)} <span class="dot dot-${health}"></span></span>
      <span class="h-value">${value}</span>
      <span class="h-sub">${esc(star?.label ?? '')}</span>
    </button>`;
  }).join('');

  const aspectPanels = dictionary.aspects.map((a) => {
    const rows = metricsOf(a.id).map((def) => {
      const entry = valueOf(def.id);
      const star = def.id === a.northStar ? '<span class="star" title="北极星指标">★</span> ' : '';
      const detail = entry?.detail ? `<div class="detail">${esc(entry.detail)}</div>` : '';
      return `<tr>
        <td>${star}${esc(def.label)}<div class="mid">${esc(def.id)} · ${esc(def.comparability)}</div>${detail}</td>
        <td class="num">${valueCell(def, entry)}</td>
        <td>${gateCell(def, entry)}</td>
      </tr>`;
    }).join('');

    const bundleExtra = a.id === 'bundle' && bundleReport ? renderChunkBars(bundleReport) : '';

    return `<section class="panel" id="panel-${a.id}" role="tabpanel" aria-labelledby="tab-${a.id}">
      <div class="q">${esc(a.question)}<span class="muted">(${esc(a.findings)})</span></div>
      <div class="card">
        <div class="table-scroll"><table>
          <thead><tr><th>指标</th><th class="num">当前值</th><th>等级 / 门禁</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
      </div>
      ${bundleExtra}
      <div class="card"><div class="next"><b>下一步</b>:${esc(a.next)}</div></div>
    </section>`;
  }).join('');

  return `<title>Pulse Canvas 性能看板</title>
<style>${css()}</style>
<div class="app">
  <div class="topbar">
    <h1>Pulse Canvas 性能看板</h1>
    <span class="meta">commit ${esc(snapshot.commit)} · ${esc(snapshot.timestamp.slice(0, 16).replace('T', ' '))} · machine ${esc(snapshot.machineId)} · ${esc(String(snapshot.env.cores))} 核 ${esc(snapshot.env.os)}</span>
  </div>
  <nav class="tabs" role="tablist" aria-label="性能专项">
    <button class="tab" role="tab" id="tab-overview" aria-selected="true" data-panel="overview">总览</button>
    ${tabs}
  </nav>
  <section class="panel active" id="panel-overview" role="tabpanel" aria-labelledby="tab-overview">
    <div class="card"><div class="kpis">
      <div class="kpi"><span class="kpi-v">${gatesPass}/${gatedMeasured.length}</span><span class="kpi-l">已上数据的门禁 PASS(字典共 ${gated.length} 个 gate 级)</span></div>
      <div class="kpi"><span class="kpi-v">${measuredCount}/${dictionary.metrics.length}</span><span class="kpi-l">指标已有实测值</span></div>
      <div class="kpi"><span class="kpi-v">87</span><span class="kpi-l">三轮扫描发现 · 已修 4</span></div>
    </div></div>
    <div class="health">${healthTiles}</div>
    <div class="card foot">
      <b>口径</b>:计数类指标机器无关、全局可比;时间类按 machineId 分基线,只比同机趋势。指标定义 SSOT:<code>perf/metrics.json</code> + <code>perf/program.md</code>。
      <b>刷新</b>:<code>perf:bundle</code> → <code>harness start --headless</code> + <code>perf:scenarios</code> → <code>perf:dashboard</code>。
    </div>
  </section>
  ${aspectPanels}
</div>
<script>${js()}</script>`;
};

const renderChunkBars = (bundleReport) => {
  const top = bundleReport.topChunks.slice(0, 6);
  const rest = bundleReport.metrics.totalJsKB - top.reduce((s, c) => s + c.rawKB, 0);
  const max = top[0]?.rawKB ?? 1;
  const rows = [
    ...top.map((c) => ({
      name: c.name.replace(/-[\w-]{8,}\.js$/, ''), kb: c.rawKB, entry: c.name.startsWith('index-'),
    })),
    { name: `其余 ${bundleReport.metrics.chunkCount - top.length} 个(懒加载)`, kb: rest, entry: false },
  ].map((row) => `<div class="mb-row">
      <span class="mb-name">${esc(row.name)}${row.entry ? '<span class="tag">entry</span>' : ''}</span>
      <div class="mb-track"><div class="mb-fill${row.entry ? ' strong' : ''}" style="width:${Math.max(1, Math.round((row.kb / max) * 100))}%"></div></div>
      <span class="mb-val">${fmt(row.kb)}</span>
    </div>`).join('');
  return `<div class="card"><h2>Chunk 分布(KB raw)— entry 启动时全量 parse,其余按需</h2><div class="mini-bars">${rows}</div></div>`;
};

const css = () => `
  :root {
    --page:#f9f9f7; --surface:#fcfcfb; --ink:#0b0b0b; --ink-2:#52514e; --muted:#898781;
    --grid:#e1e0d9; --border:rgba(11,11,11,0.10); --bar:#86b6ef; --bar-strong:#2a78d6; --accent:#2a78d6;
    --good:#0ca30c; --good-text:#006300; --warning:#b97f00; --critical:#d03b3b;
    --chip-muted-bg:rgba(137,135,129,0.12); --tab-active:#ffffff;
  }
  @media (prefers-color-scheme: dark) { :root {
    --page:#0d0d0d; --surface:#1a1a19; --ink:#ffffff; --ink-2:#c3c2b7; --muted:#898781;
    --grid:#2c2c2a; --border:rgba(255,255,255,0.10); --bar:#184f95; --bar-strong:#3987e5; --accent:#3987e5;
    --good:#0ca30c; --good-text:#0ca30c; --warning:#fab219; --critical:#d03b3b;
    --chip-muted-bg:rgba(137,135,129,0.16); --tab-active:#242423;
  } }
  :root[data-theme="dark"] {
    --page:#0d0d0d; --surface:#1a1a19; --ink:#ffffff; --ink-2:#c3c2b7; --muted:#898781;
    --grid:#2c2c2a; --border:rgba(255,255,255,0.10); --bar:#184f95; --bar-strong:#3987e5; --accent:#3987e5;
    --good:#0ca30c; --good-text:#0ca30c; --warning:#fab219; --critical:#d03b3b;
    --chip-muted-bg:rgba(137,135,129,0.16); --tab-active:#242423;
  }
  :root[data-theme="light"] {
    --page:#f9f9f7; --surface:#fcfcfb; --ink:#0b0b0b; --ink-2:#52514e; --muted:#898781;
    --grid:#e1e0d9; --border:rgba(11,11,11,0.10); --bar:#86b6ef; --bar-strong:#2a78d6; --accent:#2a78d6;
    --good:#0ca30c; --good-text:#006300; --warning:#b97f00; --critical:#d03b3b;
    --chip-muted-bg:rgba(137,135,129,0.12); --tab-active:#ffffff;
  }
  * { box-sizing:border-box; margin:0; }
  html { background:var(--page); }
  body { background:var(--page); color:var(--ink); font:14px/1.55 system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif; }
  .app { max-width:1020px; margin:0 auto; padding:20px 20px 56px; }
  .topbar { display:flex; align-items:baseline; justify-content:space-between; gap:12px; flex-wrap:wrap; padding:4px 2px 14px; }
  .topbar h1 { font-size:19px; font-weight:650; letter-spacing:-0.01em; }
  .topbar .meta { color:var(--muted); font-size:12px; font-variant-numeric:tabular-nums; }
  .tabs { display:flex; gap:4px; overflow-x:auto; padding:4px; background:var(--chip-muted-bg); border-radius:10px; scrollbar-width:none; }
  .tabs::-webkit-scrollbar { display:none; }
  .tab { flex:none; border:none; background:transparent; color:var(--ink-2); font:600 13px/1 inherit; font-family:inherit; padding:9px 14px; border-radius:7px; cursor:pointer; display:inline-flex; align-items:center; gap:7px; white-space:nowrap; }
  .tab:hover { color:var(--ink); }
  .tab:focus-visible { outline:2px solid var(--accent); outline-offset:1px; }
  .tab[aria-selected="true"] { background:var(--tab-active); color:var(--ink); box-shadow:0 1px 2px rgba(0,0,0,0.08); }
  .dot { width:7px; height:7px; border-radius:50%; flex:none; }
  .dot-good { background:var(--good); } .dot-warn { background:var(--warning); }
  .dot-muted { background:var(--muted); opacity:0.5; } .dot-critical { background:var(--critical); }
  .panel { display:none; flex-direction:column; gap:14px; padding-top:16px; }
  .panel.active { display:flex; }
  .card { background:var(--surface); border:1px solid var(--border); border-radius:10px; padding:16px 18px; }
  .card h2 { font-size:13px; color:var(--ink-2); font-weight:600; margin-bottom:10px; }
  .q { font-size:14px; color:var(--ink-2); border-left:3px solid var(--accent); padding:2px 0 2px 12px; }
  .kpis { display:flex; gap:24px; flex-wrap:wrap; }
  .kpi { display:flex; flex-direction:column; gap:1px; }
  .kpi-v { font-size:22px; font-weight:650; font-variant-numeric:tabular-nums; }
  .kpi-l { font-size:11.5px; color:var(--muted); }
  .health { display:grid; grid-template-columns:repeat(auto-fit,minmax(155px,1fr)); gap:10px; }
  .h-tile { background:var(--surface); border:1px solid var(--border); border-radius:10px; padding:13px 14px; display:flex; flex-direction:column; gap:5px; cursor:pointer; text-align:left; font-family:inherit; color:var(--ink); }
  .h-tile:hover { border-color:var(--accent); }
  .h-tile:focus-visible { outline:2px solid var(--accent); outline-offset:1px; }
  .h-name { font-size:12px; font-weight:600; color:var(--ink-2); display:flex; justify-content:space-between; align-items:center; gap:6px; }
  .h-value { font-size:20px; font-weight:650; font-variant-numeric:tabular-nums; }
  .h-value .empty { color:var(--muted); font-weight:500; font-size:14px; }
  .h-value .unit, .unit { font-size:12px; font-weight:500; color:var(--ink-2); }
  .h-sub { font-size:11px; color:var(--muted); }
  .table-scroll { overflow-x:auto; }
  table { width:100%; border-collapse:collapse; font-size:13px; min-width:480px; }
  th { text-align:left; color:var(--muted); font-weight:500; font-size:11px; text-transform:uppercase; letter-spacing:0.05em; padding:0 12px 7px 0; border-bottom:1px solid var(--grid); }
  td { padding:8px 12px 8px 0; border-bottom:1px solid var(--grid); vertical-align:top; }
  tr:last-child td { border-bottom:none; }
  .num, th.num { text-align:right; font-variant-numeric:tabular-nums; white-space:nowrap; }
  .muted { color:var(--muted); }
  .mid { font-size:11px; color:var(--muted); font-family:ui-monospace,monospace; margin-top:1px; }
  .detail { font-size:11.5px; color:var(--muted); margin-top:2px; }
  .star { color:var(--warning); }
  .status-good { color:var(--good-text); font-weight:600; white-space:nowrap; }
  .status-critical { color:var(--critical); font-weight:600; white-space:nowrap; }
  .next { font-size:12.5px; color:var(--ink-2); }
  .next b { color:var(--ink); font-weight:600; }
  .mini-bars { display:flex; flex-direction:column; gap:5px; }
  .mb-row { display:grid; grid-template-columns:minmax(120px,210px) 1fr 64px; gap:10px; align-items:center; }
  .mb-name { font-size:12px; color:var(--ink-2); text-align:right; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .tag { margin-left:6px; font-size:10px; color:var(--muted); border:1px solid var(--grid); border-radius:4px; padding:0 4px; }
  .mb-track { height:12px; border-left:1px solid var(--grid); }
  .mb-fill { height:10px; margin-top:1px; background:var(--bar); border-radius:0 4px 4px 0; min-width:2px; }
  .mb-fill.strong { background:var(--bar-strong); }
  .mb-val { font-size:12px; color:var(--ink-2); font-variant-numeric:tabular-nums; }
  .foot { font-size:12px; color:var(--muted); line-height:1.7; }
  .foot code { background:var(--chip-muted-bg); border-radius:4px; padding:1px 6px; font-size:11.5px; }
  @media (max-width:560px) { .app { padding:14px 12px 40px; } .mb-row { grid-template-columns:minmax(90px,130px) 1fr 56px; } }
`;

const js = () => `
  const tabs = Array.from(document.querySelectorAll('.tab'));
  const panels = Array.from(document.querySelectorAll('.panel'));
  const activate = (name, updateHash = true) => {
    for (const tab of tabs) tab.setAttribute('aria-selected', String(tab.dataset.panel === name));
    for (const panel of panels) panel.classList.toggle('active', panel.id === 'panel-' + name);
    if (updateHash) history.replaceState(null, '', '#' + name);
  };
  for (const tab of tabs) tab.addEventListener('click', () => activate(tab.dataset.panel));
  for (const tile of document.querySelectorAll('[data-goto]')) {
    tile.addEventListener('click', () => activate(tile.dataset.goto));
  }
  document.querySelector('.tabs').addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const current = tabs.findIndex((t) => t.getAttribute('aria-selected') === 'true');
    const next = (current + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    tabs[next].focus();
    activate(tabs[next].dataset.panel);
  });
  const initial = location.hash.slice(1);
  if (panels.some((p) => p.id === 'panel-' + initial)) activate(initial, false);
`;
