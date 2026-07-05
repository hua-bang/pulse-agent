/**
 * Renderer for the six-aspect performance dashboard, Rsdoctor/Lighthouse
 * style: a machine-generated verdict + actionable alerts form the conclusion
 * layer; raw metrics are the evidence layer below. Pure function of
 * (dictionary, snapshot, bundleReport, rules output) → self-contained HTML.
 */

const esc = (value) =>
  String(value).replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));

const fmt = (n) => (typeof n === 'number' ? n.toLocaleString('en-US') : String(n));

const LEVEL_LABEL = { gate: '门禁', warn: '观测', record: '记录' };
const SEV_LABEL = { high: 'HIGH', medium: 'MED', info: 'INFO' };

const aspectHealth = (aspect, defs, valueOf) => {
  const measured = defs.filter((d) => valueOf(d.id) !== undefined);
  if (measured.length === 0) return 'muted';
  if (measured.some((d) => valueOf(d.id)?.pass === false)) return 'critical';
  return measured.length === defs.length ? 'good' : 'warn';
};

const statusCell = (def, entry) => {
  if (!entry) return '<span class="muted">—</span>';
  if (def.unit === 'bool') {
    return entry.value
      ? '<span class="status-good">✓ 保持</span>'
      : '<span class="status-critical">✗ 被破坏</span>';
  }
  if (entry.pass === undefined) return '<span class="muted">—</span>';
  const limit = entry.limit !== undefined ? ` ≤ ${fmt(entry.limit)}` : '';
  return entry.pass
    ? `<span class="status-good">✓ PASS${limit}</span>`
    : `<span class="status-critical">✗ FAIL${limit}</span>`;
};

const valueCell = (def, entry, prevValue) => {
  if (!entry) return `<span class="muted">${def.instrumented ? '已埋待采' : '未建'}</span>`;
  if (def.unit === 'bool') return entry.value ? '<b>✓</b>' : '<b>✗</b>';
  const delta = typeof prevValue === 'number' && prevValue !== entry.value
    ? `<div class="prev">上次 ${fmt(prevValue)}</div>`
    : '';
  return `<b>${fmt(entry.value)}</b><span class="unit"> ${esc(def.unit)}</span>${delta}`;
};

const alertCard = (alert, aspectName) => `
  <div class="alert alert-${alert.severity}">
    <div class="alert-head">
      <span class="sev sev-${alert.severity}">${SEV_LABEL[alert.severity]}</span>
      <span class="alert-title">${esc(alert.title)}</span>
      ${aspectName ? `<span class="alert-aspect">${esc(aspectName)}</span>` : ''}
    </div>
    <div class="alert-evidence">${esc(alert.evidence)}</div>
    <div class="alert-fix">→ ${esc(alert.suggestion)}<span class="ref"> · ${esc(alert.ref)}</span></div>
  </div>`;

// Inline SVG sparkline (self-contained, theme-aware via currentColor). Marks
// the last point; direction color is applied by the caller via a wrapper class.
const sparkline = (values, w = 96, h = 22) => {
  if (values.length < 2) return '';
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const stepX = w / (values.length - 1);
  const pts = values.map((v, i) => `${(i * stepX).toFixed(1)},${(h - 2 - ((v - min) / span) * (h - 4)).toFixed(1)}`);
  const [lx, ly] = pts[pts.length - 1].split(',');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true">`
    + `<polyline fill="none" stroke="currentColor" stroke-width="1.5" points="${pts.join(' ')}"/>`
    + `<circle cx="${lx}" cy="${ly}" r="2" fill="currentColor"/></svg>`;
};

const trendRow = (label, unit, values, lowerIsBetter) => {
  const first = values[0];
  const last = values[values.length - 1];
  const changed = first !== last;
  const improved = lowerIsBetter ? last < first : last > first;
  const dir = !changed ? 'flat' : improved ? 'good' : 'bad';
  const arrow = !changed ? '→' : last > first ? '↑' : '↓';
  return `<div class="trend-row">
    <div class="trend-label">${esc(label)}</div>
    <div class="trend-spark trend-${dir}">${sparkline(values)}</div>
    <div class="trend-delta trend-${dir}">${fmt(first)} ${arrow} <b>${fmt(last)}</b><span class="unit"> ${esc(unit)}</span></div>
  </div>`;
};

export const renderDashboardHtml = (dictionary, snapshot, bundleReport, { alerts, previous }, verdict, series = []) => {
  const byId = new Map(snapshot.metrics.map((m) => [m.id, m]));
  const valueOf = (id) => byId.get(id);
  const prevOf = (id) => previous?.metrics.find((m) => m.id === id)?.value;
  const metricsOf = (aspectId) => dictionary.metrics.filter((m) => m.aspect === aspectId);
  const aspectName = (id) => dictionary.aspects.find((a) => a.id === id)?.name ?? id;

  const measuredCount = dictionary.metrics.filter((m) => valueOf(m.id) !== undefined).length;

  const tabs = dictionary.aspects.map((a) => {
    const health = aspectHealth(a, metricsOf(a.id), valueOf);
    const count = alerts.filter((x) => x.aspect === a.id && x.severity !== 'info').length;
    return `<button class="tab" role="tab" id="tab-${a.id}" aria-selected="false" data-panel="${a.id}">
      <span class="dot dot-${health}"></span>${esc(a.name)}${count ? `<span class="tab-badge">${count}</span>` : ''}</button>`;
  }).join('');

  const healthTiles = dictionary.aspects.map((a) => {
    const health = aspectHealth(a, metricsOf(a.id), valueOf);
    const star = dictionary.metrics.find((m) => m.id === a.northStar);
    const entry = star ? valueOf(star.id) : undefined;
    const value = entry
      ? (star.unit === 'bool' ? (entry.value ? '✓' : '✗')
        : `${fmt(entry.value)}<span class="unit"> ${esc(star.unit)}</span>`)
      : `<span class="empty">${star?.instrumented ? '已埋待采' : '未建'}</span>`;
    return `<button class="h-tile" data-goto="${a.id}">
      <span class="h-name">${esc(a.name)} <span class="dot dot-${health}"></span></span>
      <span class="h-value">${value}</span>
      <span class="h-sub">${esc(star?.label ?? '')}</span>
    </button>`;
  }).join('');

  const overviewAlerts = alerts.map((a) => alertCard(a, aspectName(a.aspect))).join('')
    || '<div class="muted" style="padding:6px 0">本次运行未触发任何告警。</div>';

  // Trend sparklines (same-machine series). All headline metrics are
  // lower-is-better, so a downward line = improvement (e.g. B1's typing fix).
  const HEADLINE = [
    ['interact.typing.counter.nodes_array_replace', '打字 整数组替换'],
    ['interact.typing.inp_p95_ms', '打字 INP p95'],
    ['bundle.entry_raw_kb', '入口 chunk raw'],
    ['memory.ws_cycle.heap_slope', 'workspace 堆斜率'],
    ['main.loop_delay_p99_ms', '主进程 loop-delay p99'],
  ];
  const seriesOf = (id) => series.map((s) => s.metrics.find((m) => m.id === id)?.value).filter((v) => typeof v === 'number');
  const trendRows = HEADLINE.map(([id, label]) => {
    const def = dictionary.metrics.find((m) => m.id === id);
    const values = seriesOf(id);
    return values.length >= 2 ? trendRow(label, def?.unit ?? '', values, true) : '';
  }).filter(Boolean).join('');
  const trendCard = trendRows
    ? `<div class="card"><h2>关键指标趋势(同机 · ${series.length} 次运行,越低越好)</h2>${trendRows}</div>`
    : '';

  const scenarioConditions = snapshot.env.seedNodes
    ? `场景条件:@${snapshot.env.seedNodes} 节点画布 · 打字 120 字符(25ms 间隔)· 拖拽 90 步 · n=1(时间类指标单样本,结论以多轮中位数为准)`
    : '场景条件:默认画布 · n=1';

  const aspectPanels = dictionary.aspects.map((a) => {
    const defs = metricsOf(a.id);
    const measured = defs.filter((d) => valueOf(d.id) !== undefined);
    const unmeasured = defs.filter((d) => valueOf(d.id) === undefined);
    const aspectAlerts = alerts.filter((x) => x.aspect === a.id);

    const row = (def) => {
      const entry = valueOf(def.id);
      const star = def.id === a.northStar ? '<span class="star" title="北极星指标">★</span> ' : '';
      const detail = entry?.detail ? `<div class="detail">${esc(entry.detail)}</div>` : '';
      return `<tr>
        <td>${star}${esc(def.label)} <span class="lvl">${LEVEL_LABEL[def.level] ?? esc(def.level)}</span>
          <div class="mid">${esc(def.id)} · ${esc(def.comparability)}</div>${detail}</td>
        <td class="num">${valueCell(def, entry, prevOf(def.id))}</td>
        <td>${statusCell(def, entry)}</td>
      </tr>`;
    };

    const measuredTable = measured.length
      ? `<div class="table-scroll"><table>
          <thead><tr><th>指标</th><th class="num">当前值</th><th>状态</th></tr></thead>
          <tbody>${measured.map(row).join('')}</tbody>
        </table></div>`
      : '<div class="muted">该专项尚无实测数据。</div>';

    const unmeasuredBlock = unmeasured.length
      ? `<details class="unbuilt"><summary>未建 / 待采 ${unmeasured.length} 项</summary>
          <div class="table-scroll"><table><tbody>${unmeasured.map(row).join('')}</tbody></table></div>
        </details>`
      : '';

    return `<section class="panel" id="panel-${a.id}" role="tabpanel" aria-labelledby="tab-${a.id}">
      <div class="q">${esc(a.question)}<span class="muted">(${esc(a.findings)})</span></div>
      ${aspectAlerts.map((x) => alertCard(x)).join('')}
      <div class="card">
        ${a.id === 'interact' ? `<div class="cond">${esc(scenarioConditions)}</div>` : ''}
        ${measuredTable}
        ${unmeasuredBlock}
      </div>
      ${a.id === 'bundle' && bundleReport ? renderChunkBars(bundleReport) : ''}
      ${a.id === 'bundle' ? renderEntryDepBars(bundleReport) : ''}
      <div class="card"><div class="next"><b>下一步</b>:${esc(a.next)}</div></div>
    </section>`;
  }).join('');

  return `<title>Pulse Canvas 性能看板</title>
<style>${css()}</style>
<div class="app">
  <div class="topbar">
    <h1>Pulse Canvas 性能看板</h1>
    <span class="meta">commit ${esc(snapshot.commit)} · ${esc(snapshot.timestamp.slice(0, 16).replace('T', ' '))} · machine ${esc(snapshot.machineId)} · ${esc(String(snapshot.env.cores))} 核 ${esc(snapshot.env.os)}${previous ? ' · 对比上次 ' + esc(previous.timestamp.slice(5, 16).replace('T', ' ')) : ''}</span>
  </div>
  <nav class="tabs" role="tablist" aria-label="性能专项">
    <button class="tab" role="tab" id="tab-overview" aria-selected="true" data-panel="overview">总览${alerts.filter((a) => a.severity === 'high').length ? `<span class="tab-badge bad">${alerts.filter((a) => a.severity === 'high').length}</span>` : ''}</button>
    ${tabs}
  </nav>
  <section class="panel active" id="panel-overview" role="tabpanel" aria-labelledby="tab-overview">
    <div class="verdict card">${esc(verdict)}<span class="verdict-sub">${measuredCount}/${dictionary.metrics.length} 指标有实测值 · 87 条发现已修 4</span></div>
    <div class="health">${healthTiles}</div>
    <div class="card"><h2>告警(规则引擎,按严重度)</h2>${overviewAlerts}</div>
    ${trendCard}
    <div class="card foot">
      <b>口径</b>:计数类指标机器无关、全局可比;时间类按 machineId 分基线,只比同机趋势。定义 SSOT:<code>perf/metrics.json</code> + <code>perf/program.md</code>。
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

// D2: per-dependency breakdown of the entry chunk (A5's entryDepAttribution).
// Reuses the same proportional-bar visual language as renderChunkBars above
// (no external chart lib) rather than a true nested-rectangle treemap —
// dependency counts here are small (single digits), so a sorted bar list
// reads just as clearly and stays consistent with the rest of the tab.
const renderEntryDepBars = (bundleReport) => {
  const attribution = bundleReport?.entryDepAttribution;
  if (!attribution) {
    return `<div class="card"><h2>Entry 依赖归因(A5)</h2>
      <div class="muted">未建 — 用 <code>PULSE_CANVAS_PERF_ANALYZE=1 pnpm build</code>
      (或直接 <code>perf:report</code>,已默认带上)重新构建即可采集。</div></div>`;
  }
  const rows = [
    { name: '应用自身代码', kb: attribution.appOwnKB, self: true },
    ...attribution.deps.map((d) => ({ name: d.pkg, kb: d.rawKB, self: false })),
  ];
  const max = Math.max(...rows.map((r) => r.kb), 1);
  const bars = rows.map((row) => `<div class="mb-row">
      <span class="mb-name">${esc(row.name)}${row.self ? '<span class="tag">app</span>' : ''}</span>
      <div class="mb-track"><div class="mb-fill${row.self ? ' strong' : ''}" style="width:${Math.max(1, Math.round((row.kb / max) * 100))}%"></div></div>
      <span class="mb-val">${fmt(row.kb)}</span>
    </div>`).join('');
  return `<div class="card"><h2>Entry 依赖归因(KB,tree-shake 后/压缩前)— ${esc(attribution.chunkFileName)}</h2>
    <div class="mini-bars">${bars}</div></div>`;
};

const css = () => `
  :root {
    --page:#f9f9f7; --surface:#fcfcfb; --ink:#0b0b0b; --ink-2:#52514e; --muted:#898781;
    --grid:#e1e0d9; --border:rgba(11,11,11,0.10); --bar:#86b6ef; --bar-strong:#2a78d6; --accent:#2a78d6;
    --good:#0ca30c; --good-text:#006300; --warning:#b97f00; --serious:#b45309; --critical:#d03b3b;
    --chip-muted-bg:rgba(137,135,129,0.12); --tab-active:#ffffff;
    --sev-high-bg:rgba(208,59,59,0.08); --sev-med-bg:rgba(236,131,90,0.10); --sev-info-bg:rgba(137,135,129,0.08);
  }
  @media (prefers-color-scheme: dark) { :root {
    --page:#0d0d0d; --surface:#1a1a19; --ink:#ffffff; --ink-2:#c3c2b7; --muted:#898781;
    --grid:#2c2c2a; --border:rgba(255,255,255,0.10); --bar:#184f95; --bar-strong:#3987e5; --accent:#3987e5;
    --good:#0ca30c; --good-text:#0ca30c; --warning:#fab219; --serious:#ec835a; --critical:#d03b3b;
    --chip-muted-bg:rgba(137,135,129,0.16); --tab-active:#242423;
    --sev-high-bg:rgba(208,59,59,0.14); --sev-med-bg:rgba(236,131,90,0.12); --sev-info-bg:rgba(137,135,129,0.10);
  } }
  :root[data-theme="dark"] {
    --page:#0d0d0d; --surface:#1a1a19; --ink:#ffffff; --ink-2:#c3c2b7; --muted:#898781;
    --grid:#2c2c2a; --border:rgba(255,255,255,0.10); --bar:#184f95; --bar-strong:#3987e5; --accent:#3987e5;
    --good:#0ca30c; --good-text:#0ca30c; --warning:#fab219; --serious:#ec835a; --critical:#d03b3b;
    --chip-muted-bg:rgba(137,135,129,0.16); --tab-active:#242423;
    --sev-high-bg:rgba(208,59,59,0.14); --sev-med-bg:rgba(236,131,90,0.12); --sev-info-bg:rgba(137,135,129,0.10);
  }
  :root[data-theme="light"] {
    --page:#f9f9f7; --surface:#fcfcfb; --ink:#0b0b0b; --ink-2:#52514e; --muted:#898781;
    --grid:#e1e0d9; --border:rgba(11,11,11,0.10); --bar:#86b6ef; --bar-strong:#2a78d6; --accent:#2a78d6;
    --good:#0ca30c; --good-text:#006300; --warning:#b97f00; --serious:#b45309; --critical:#d03b3b;
    --chip-muted-bg:rgba(137,135,129,0.12); --tab-active:#ffffff;
    --sev-high-bg:rgba(208,59,59,0.08); --sev-med-bg:rgba(236,131,90,0.10); --sev-info-bg:rgba(137,135,129,0.08);
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
  .tab-badge { font-size:10.5px; background:var(--sev-med-bg); color:var(--serious); border-radius:999px; padding:1px 6px; font-variant-numeric:tabular-nums; }
  .tab-badge.bad { background:var(--sev-high-bg); color:var(--critical); }
  .dot { width:7px; height:7px; border-radius:50%; flex:none; }
  .dot-good { background:var(--good); } .dot-warn { background:var(--warning); }
  .dot-muted { background:var(--muted); opacity:0.5; } .dot-critical { background:var(--critical); }
  .panel { display:none; flex-direction:column; gap:12px; padding-top:16px; }
  .panel.active { display:flex; }
  .card { background:var(--surface); border:1px solid var(--border); border-radius:10px; padding:16px 18px; }
  .card h2 { font-size:13px; color:var(--ink-2); font-weight:600; margin-bottom:10px; }
  .q { font-size:14px; color:var(--ink-2); border-left:3px solid var(--accent); padding:2px 0 2px 12px; }
  .verdict { font-size:15px; font-weight:600; display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; align-items:baseline; }
  .verdict-sub { font-size:12px; font-weight:500; color:var(--muted); }
  .health { display:grid; grid-template-columns:repeat(auto-fit,minmax(155px,1fr)); gap:10px; }
  .h-tile { background:var(--surface); border:1px solid var(--border); border-radius:10px; padding:13px 14px; display:flex; flex-direction:column; gap:5px; cursor:pointer; text-align:left; font-family:inherit; color:var(--ink); }
  .h-tile:hover { border-color:var(--accent); }
  .h-tile:focus-visible { outline:2px solid var(--accent); outline-offset:1px; }
  .h-name { font-size:12px; font-weight:600; color:var(--ink-2); display:flex; justify-content:space-between; align-items:center; gap:6px; }
  .h-value { font-size:20px; font-weight:650; font-variant-numeric:tabular-nums; }
  .h-value .empty { color:var(--muted); font-weight:500; font-size:14px; }
  .h-value .unit, .unit { font-size:12px; font-weight:500; color:var(--ink-2); }
  .h-sub { font-size:11px; color:var(--muted); }
  .alert { border-radius:8px; padding:10px 14px; margin-bottom:8px; }
  .alert-high { background:var(--sev-high-bg); }
  .alert-medium { background:var(--sev-med-bg); }
  .alert-info { background:var(--sev-info-bg); }
  .alert-head { display:flex; align-items:baseline; gap:8px; flex-wrap:wrap; }
  .sev { font-size:10px; font-weight:700; letter-spacing:0.06em; border-radius:4px; padding:1px 6px; }
  .sev-high { color:#fff; background:var(--critical); }
  .sev-medium { color:#fff; background:var(--serious); }
  .sev-info { color:var(--ink-2); background:var(--chip-muted-bg); }
  .alert-title { font-weight:600; font-size:13.5px; }
  .alert-aspect { margin-left:auto; font-size:11px; color:var(--muted); }
  .alert-evidence { font-size:12.5px; color:var(--ink-2); margin-top:3px; font-variant-numeric:tabular-nums; }
  .alert-fix { font-size:12.5px; color:var(--ink-2); margin-top:2px; }
  .alert-fix .ref { color:var(--muted); font-size:11px; }
  .cond { font-size:12px; color:var(--muted); margin-bottom:10px; }
  .table-scroll { overflow-x:auto; }
  table { width:100%; border-collapse:collapse; font-size:13px; min-width:480px; }
  th { text-align:left; color:var(--muted); font-weight:500; font-size:11px; text-transform:uppercase; letter-spacing:0.05em; padding:0 12px 7px 0; border-bottom:1px solid var(--grid); }
  td { padding:8px 12px 8px 0; border-bottom:1px solid var(--grid); vertical-align:top; }
  tr:last-child td { border-bottom:none; }
  .num, th.num { text-align:right; font-variant-numeric:tabular-nums; white-space:nowrap; }
  .muted { color:var(--muted); }
  .mid { font-size:11px; color:var(--muted); font-family:ui-monospace,monospace; margin-top:1px; }
  .detail { font-size:11.5px; color:var(--muted); margin-top:2px; }
  .prev { font-size:11px; color:var(--muted); font-weight:400; }
  .lvl { font-size:10px; color:var(--muted); border:1px solid var(--grid); border-radius:4px; padding:0 5px; vertical-align:1px; }
  .star { color:var(--warning); }
  .status-good { color:var(--good-text); font-weight:600; white-space:nowrap; }
  .status-critical { color:var(--critical); font-weight:600; white-space:nowrap; }
  .next { font-size:12.5px; color:var(--ink-2); }
  .next b { color:var(--ink); font-weight:600; }
  .unbuilt { margin-top:10px; }
  .unbuilt summary { font-size:12.5px; color:var(--muted); cursor:pointer; padding:4px 0; }
  .unbuilt summary:hover { color:var(--ink-2); }
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
  .trend-row { display:grid; grid-template-columns:1fr 104px 168px; gap:12px; align-items:center; padding:6px 0; border-bottom:1px solid var(--grid); }
  .trend-row:last-child { border-bottom:none; }
  .trend-label { font-size:12.5px; color:var(--ink-2); }
  .trend-spark { display:flex; justify-content:flex-end; }
  .spark { display:block; }
  .trend-delta { font-size:12.5px; text-align:right; font-variant-numeric:tabular-nums; color:var(--ink-2); }
  .trend-good, .trend-good .spark { color:var(--good); }
  .trend-bad, .trend-bad .spark { color:var(--critical); }
  .trend-flat, .trend-flat .spark { color:var(--muted); }
  .trend-delta.trend-good b { color:var(--good-text); }
  .trend-delta.trend-bad b { color:var(--critical); }
  @media (max-width:560px) { .app { padding:14px 12px 40px; } .mb-row { grid-template-columns:minmax(90px,130px) 1fr 56px; } .trend-row { grid-template-columns:1fr 70px 120px; } }
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
