/**
 * Renderer for the six-aspect performance dashboard, Rsdoctor/Lighthouse
 * style: a machine-generated verdict + actionable alerts form the conclusion
 * layer; raw metrics are the evidence layer below. Pure function of
 * (dictionary, snapshot, bundleReport, rules output) → self-contained HTML.
 */
import { summarizeCoverage } from './coverage.mjs';
import { organizeAspectMetrics } from './metric-presentation.mjs';

const esc = (value) =>
  String(value).replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));

const fmt = (n) => (typeof n === 'number' ? n.toLocaleString('en-US') : String(n));

const LEVEL_LABEL = { gate: '门禁', warn: '观测', record: '记录' };
const SEV_LABEL = { high: 'HIGH', medium: 'MED', info: 'INFO' };

const aspectHealth = (defs, policyOf) => {
  const statuses = defs.map((definition) => policyOf(definition.id)?.status).filter(Boolean);
  if (statuses.length === 0 || statuses.every((status) => ['pending', 'not-applicable'].includes(status))) {
    return 'muted';
  }
  if (statuses.includes('missed')) return 'critical';
  if (statuses.includes('near-warning')) return 'warn';
  return statuses.length === defs.length && statuses.every((status) => status === 'met') ? 'good' : 'warn';
};

const gateStatusOf = (entry, policy) => {
  if (entry?.pass === true) return 'pass';
  if (entry?.pass === false) return 'fail';
  return policy?.gateStatus ?? 'not-configured';
};

const gateStatusCell = (entry, policy) => {
  const status = gateStatusOf(entry, policy);
  if (status === 'unavailable') return '<span class="status-critical">✗ 缺测</span>';
  if (status === 'not-applicable') return '<span class="muted">不适用</span>';
  if (status === 'not-required') return '<span class="muted">本次不要求</span>';
  const pass = entry?.pass ?? policy?.gatePass;
  if (pass === undefined) return '<span class="muted">—</span>';
  const operator = {
    max: '≤', ratchet: '≤', min: '≥', exact: '=', true: '=',
  }[entry?.gateOperator ?? policy?.gateOperator] ?? '≤';
  const gateLimit = entry?.limit ?? policy?.gateLimit;
  const limit = gateLimit !== undefined ? ` ${operator} ${fmt(gateLimit)}` : '';
  return pass
    ? `<span class="status-good">✓ PASS${limit}</span>`
    : `<span class="status-critical">✗ FAIL${limit}</span>`;
};

const targetOperator = (direction) => ({ lower: '≤', higher: '≥', exact: '=', true: '=' }[direction] ?? '');

const targetCell = (def, policy) => {
  if (!policy || policy.target === null || policy.target === undefined) {
    return '<span class="muted">待校准</span>';
  }
  const target = def.direction === 'true' ? '保持 true' : `${targetOperator(def.direction)} ${fmt(policy.target)}`;
  const unit = def.unit === 'bool' ? '' : ` ${esc(def.unit)}`;
  const headroom = typeof policy.headroom === 'number'
    ? `<div class="target-headroom ${policy.headroom >= 0 ? 'positive' : 'negative'}">${policy.headroom >= 0 ? '余量' : '差'} ${fmt(Math.abs(policy.headroom))}${unit}</div>`
    : '';
  return `<span class="target-threshold">${target}${unit}</span>${headroom}`;
};

const targetStatusCell = (policy) => {
  const status = policy?.status ?? 'pending';
  const presentation = {
    met: ['status-good', '✓ 达标'],
    'near-warning': ['status-warning', '△ 接近预警'],
    missed: ['status-critical', '✗ 未达标'],
    pending: ['muted', '待校准'],
    'not-applicable': ['muted', '不适用'],
  }[status] ?? ['muted', '待校准'];
  return `<span class="${presentation[0]}" data-target-status="${status}">${presentation[1]}</span>`;
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

export const renderDashboardHtml = (
  dictionary,
  snapshot,
  bundleReport,
  { alerts, previous },
  verdict,
  series = [],
  policyContext = {},
) => {
  const byId = new Map(snapshot.metrics.map((m) => [m.id, m]));
  const valueOf = (id) => byId.get(id);
  const policyOf = (id) => valueOf(id)?.policy ?? policyContext.policiesById?.[id];
  const prevOf = (id) => previous?.metrics.find((m) => m.id === id)?.value;
  const metricsOf = (aspectId) => dictionary.metrics.filter((m) => m.aspect === aspectId);
  const aspectName = (id) => dictionary.aspects.find((a) => a.id === id)?.name ?? id;

  const coverage = summarizeCoverage(dictionary, snapshot);

  const tabs = dictionary.aspects.map((a) => {
    const health = aspectHealth(
      metricsOf(a.id).filter((definition) => definition.displayPriority === 'primary'),
      policyOf,
    );
    const count = alerts.filter((x) => x.aspect === a.id && x.severity !== 'info').length;
    return `<button class="tab" role="tab" id="tab-${a.id}" aria-selected="false" data-panel="${a.id}">
      <span class="dot dot-${health}"></span>${esc(a.name)}${count ? `<span class="tab-badge">${count}</span>` : ''}</button>`;
  }).join('');

  const healthTiles = dictionary.aspects.map((a) => {
    const health = aspectHealth(
      metricsOf(a.id).filter((definition) => definition.displayPriority === 'primary'),
      policyOf,
    );
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

  // Trend sparklines use the metric direction; cache-hit style metrics are
  // higher-is-better while latency/size metrics are lower-is-better.
  const HEADLINE = [
    ['interact.typing.counter.nodes_array_replace', '打字 整数组替换'],
    ['interact.typing.inp_p95_ms', '打字 INP p95'],
    ['bundle.entry_raw_kb', '入口 chunk raw'],
    ['memory.ws_cycle.post_capacity_heap_slope', 'LRU 容量后堆斜率'],
    ['main.loop_delay_p99_ms', '主进程 loop-delay p99'],
  ];
  const seriesOf = (id) => series.map((s) => s.metrics.find((m) => m.id === id)?.value).filter((v) => typeof v === 'number');
  const trendRows = HEADLINE.map(([id, label]) => {
    const def = dictionary.metrics.find((m) => m.id === id);
    const values = seriesOf(id);
    return values.length >= 2 ? trendRow(label, def?.unit ?? '', values, def?.direction !== 'higher') : '';
  }).filter(Boolean).join('');
  const trendCard = trendRows
    ? `<div class="card"><h2>关键指标趋势(同机 · ${series.length} 次运行,按各指标方向判断)</h2>${trendRows}</div>`
    : '';

  const interactionRuns = Math.max(
    1,
    ...snapshot.metrics
      .filter((metric) => metric.id.startsWith('interact.') && Number.isFinite(metric.runs))
      .map((metric) => metric.runs),
  );
  const scenarioConditions = snapshot.env.seedNodes
    ? `场景条件:@${snapshot.env.seedNodes} 节点画布 · 打字 120 字符(25ms 间隔) · 调整尺寸/拖拽各 90 步 · Pan/Zoom 50 wheel/run · repeat ${interactionRuns}(时间取中位数并保留 raw,帧另保留单轮最差值)`
    : `场景条件:默认画布 · repeat ${interactionRuns}`;

  const aspectPanels = dictionary.aspects.map((a) => {
    const defs = metricsOf(a.id);
    const aspectAlerts = alerts.filter((x) => x.aspect === a.id);
    const presentation = organizeAspectMetrics(a, defs);
    const dimensionNames = new Map((a.dimensions ?? []).map((dimension) => [dimension.id, dimension.name]));
    const attentionRefs = new Set(aspectAlerts.map((alert) => alert.ref));

    const row = (def) => {
      const entry = valueOf(def.id);
      const policy = policyOf(def.id);
      const star = def.id === a.northStar ? '<span class="star">北极星</span> ' : '';
      const detail = entry?.detail ? `<div class="detail">${esc(entry.detail)}</div>` : '';
      return `<tr data-metric-id="${esc(def.id)}">
        <td>${star}${esc(def.label)} <span class="lvl">${LEVEL_LABEL[def.level] ?? esc(def.level)}</span>
          <div class="mid">${esc(def.id)} · ${esc(def.comparability)}</div>${detail}</td>
        <td class="num">${valueCell(def, entry, prevOf(def.id))}</td>
        <td class="target">${targetCell(def, policy)}</td>
        <td>${targetStatusCell(policy)}</td>
        <td data-gate-status="${gateStatusOf(entry, policy)}">${gateStatusCell(entry, policy)}</td>
      </tr>`;
    };

    const table = (definitions) => `<div class="table-scroll metric-table"><table>
      <thead><tr><th>指标</th><th class="num">当前值</th><th>目标 / 余量</th><th>目标状态</th><th>Gate</th></tr></thead>
      <tbody>${definitions.map(row).join('')}</tbody>
    </table></div>`;

    const primaryCards = presentation.primary.map((def) => {
      const entry = valueOf(def.id);
      const policy = policyOf(def.id);
      const detail = entry?.detail
        ? `<div class="metric-kpi-detail">${esc(entry.detail)}</div>`
        : '';
      return `<article class="metric-kpi" data-summary-metric="${esc(def.id)}">
        <div class="metric-kpi-top">
          <span class="metric-kpi-dimension">${esc(dimensionNames.get(def.dimension) ?? '关键结果')}</span>
          ${def.id === a.northStar ? '<span class="north-star">北极星</span>' : ''}
        </div>
        <div class="metric-kpi-label">${esc(def.label)}</div>
        <div class="metric-kpi-value">${valueCell(def, entry, prevOf(def.id))}</div>
        <div class="metric-kpi-target">${targetCell(def, policy)}</div>
        <div class="metric-kpi-meta"><span class="lvl">${LEVEL_LABEL[def.level] ?? esc(def.level)}</span>${targetStatusCell(policy)}</div>
        ${gateStatusOf(entry, policy) !== 'not-configured' ? `<div class="metric-kpi-gate">Gate ${gateStatusCell(entry, policy)}</div>` : ''}
        ${detail}
      </article>`;
    }).join('');

    const primaryBlock = presentation.primary.length
      ? `<section class="metric-tier metric-tier-primary" data-role="metric-summary">
          <div class="metric-tier-head">
            <span class="priority-chip priority-primary">P0</span>
            <div><h2>关键结果</h2><p>先看这些，判断该专题是否健康。</p></div>
          </div>
          <div class="metric-summary">${primaryCards}</div>
        </section>`
      : '';

    const renderTier = (priority, heading, description, groups) => {
      if (groups.length === 0) return '';
      const groupHtml = groups.map((group) => {
        const measuredCount = group.definitions.filter((def) => valueOf(def.id) !== undefined).length;
        const failingCount = group.definitions.filter(
          (def) => ['fail', 'unavailable'].includes(gateStatusOf(valueOf(def.id), policyOf(def.id))),
        ).length;
        const missedCount = group.definitions.filter((def) => policyOf(def.id)?.status === 'missed').length;
        const nearWarningCount = group.definitions.filter((def) => policyOf(def.id)?.status === 'near-warning').length;
        const needsAttention = failingCount > 0
          || missedCount > 0
          || nearWarningCount > 0
          || group.definitions.some((def) => attentionRefs.has(def.id));
        const countLabel = failingCount > 0
          ? `${failingCount} 项 Gate 失败`
          : missedCount > 0
            ? `${missedCount} 项未达标`
            : nearWarningCount > 0
              ? `${nearWarningCount} 项接近预警`
          : `${measuredCount}/${group.definitions.length} 已采`;
        return `<details class="metric-dimension metric-dimension-${priority}"
            data-priority="${priority}" data-dimension="${esc(group.id)}"${needsAttention ? ' open' : ''}>
          <summary>
            <span class="metric-dimension-copy">
              <span class="metric-dimension-name">${esc(group.name)}</span>
              <span class="metric-dimension-description">${esc(group.description ?? '')}</span>
            </span>
            <span class="metric-dimension-count${failingCount > 0 || missedCount > 0 ? ' issue' : ''}">${countLabel}</span>
          </summary>
          ${table(group.definitions)}
        </details>`;
      }).join('');
      return `<section class="metric-tier metric-tier-${priority}" data-role="metric-${priority}">
        <div class="metric-tier-head">
          <span class="priority-chip priority-${priority}">${priority === 'supporting' ? 'P1' : 'P2'}</span>
          <div><h2>${esc(heading)}</h2><p>${esc(description)}</p></div>
        </div>
        <div class="metric-dimensions">${groupHtml}</div>
      </section>`;
    };

    const supportingBlock = renderTier(
      'supporting',
      '分项观测',
      '按维度展开，解释关键结果由哪一段产生。',
      presentation.supporting,
    );
    const diagnosticBlock = renderTier(
      'diagnostic',
      '深入诊断',
      '排障时再看；其中部分指标不参与核心门禁。',
      presentation.diagnostic,
    );

    return `<section class="panel" id="panel-${a.id}" role="tabpanel" aria-labelledby="tab-${a.id}">
      <div class="q">${esc(a.question)}<span class="muted">(${esc(a.findings)})</span></div>
      ${aspectAlerts.map((x) => alertCard(x)).join('')}
      <div class="card metric-card">
        ${a.id === 'interact' ? `<div class="cond">${esc(scenarioConditions)}</div>` : ''}
        ${primaryBlock}
        ${supportingBlock}
        ${diagnosticBlock}
      </div>
      ${a.id === 'bundle' && bundleReport ? renderChunkBars(bundleReport) : ''}
      ${a.id === 'bundle' ? renderEntryDepBars(bundleReport) : ''}
      <div class="card"><div class="next"><b>下一步</b>:${esc(a.next)}</div></div>
    </section>`;
  }).join('');

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pulse Canvas 性能看板</title>
<style>${css()}</style>
</head>
<body>
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
    <div class="verdict card">${esc(verdict)}<span class="verdict-sub">核心 ${coverage.measured}/${coverage.total} · CDP trace 诊断 ${coverage.diagnostic.measured}/${coverage.diagnostic.total} · 87 条发现已修 4</span></div>
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
<script>${js()}</script>
</body>
</html>`;
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
  .metric-card { display:flex; flex-direction:column; gap:18px; }
  .metric-tier { display:flex; flex-direction:column; gap:10px; }
  .metric-tier + .metric-tier { padding-top:16px; border-top:1px solid var(--grid); }
  .metric-tier-head { display:flex; align-items:flex-start; gap:9px; }
  .metric-tier-head h2 { color:var(--ink); font-size:13px; margin:0; }
  .metric-tier-head p { color:var(--muted); font-size:11.5px; margin-top:1px; }
  .priority-chip { flex:none; min-width:30px; border-radius:5px; padding:2px 6px; font-size:10px; font-weight:700; text-align:center; letter-spacing:0.04em; }
  .priority-primary { color:var(--accent); background:color-mix(in srgb,var(--accent) 12%,transparent); }
  .priority-supporting { color:var(--ink-2); background:var(--chip-muted-bg); }
  .priority-diagnostic { color:var(--muted); border:1px solid var(--grid); }
  .metric-summary { display:grid; grid-template-columns:repeat(auto-fit,minmax(190px,1fr)); gap:9px; }
  .metric-kpi { min-width:0; border:1px solid var(--grid); border-radius:8px; padding:12px 13px; background:color-mix(in srgb,var(--surface) 94%,var(--accent)); }
  .metric-kpi-top { display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:7px; }
  .metric-kpi-dimension { color:var(--muted); font-size:10.5px; font-weight:600; text-transform:uppercase; letter-spacing:0.04em; }
  .north-star { color:var(--warning); font-size:10px; font-weight:650; }
  .metric-kpi-label { color:var(--ink-2); font-size:11.5px; min-height:36px; }
  .metric-kpi-value { margin-top:3px; font-size:21px; font-variant-numeric:tabular-nums; }
  .metric-kpi-value > b { font-weight:680; }
  .metric-kpi-value .unit { font-size:11.5px; }
  .metric-kpi-value .prev { display:inline; margin-left:8px; }
  .metric-kpi-target { color:var(--ink-2); font-size:11.5px; margin-top:7px; min-height:34px; }
  .metric-kpi-gate { color:var(--muted); font-size:10.5px; margin-top:5px; }
  .metric-kpi-meta { display:flex; justify-content:space-between; align-items:center; gap:8px; min-height:18px; margin-top:8px; }
  .metric-kpi-detail { color:var(--muted); font-size:10.5px; line-height:1.4; margin-top:5px; }
  .metric-kpi-scope { color:var(--muted); font-size:10.5px; }
  .metric-dimensions { display:flex; flex-direction:column; gap:7px; }
  .metric-dimension { border:1px solid var(--grid); border-radius:8px; overflow:hidden; background:color-mix(in srgb,var(--surface) 97%,var(--ink)); }
  .metric-dimension summary { cursor:pointer; padding:10px 13px; color:var(--ink-2); }
  .metric-dimension summary:hover { color:var(--ink); }
  .metric-dimension summary:focus-visible { outline:2px solid var(--accent); outline-offset:-2px; }
  .metric-dimension[open] summary { border-bottom:1px solid var(--grid); }
  .metric-dimension-copy { display:inline-flex; width:calc(100% - 108px); flex-direction:column; vertical-align:middle; margin-left:3px; }
  .metric-dimension-name { color:var(--ink); font-size:12.5px; font-weight:600; }
  .metric-dimension-description { color:var(--muted); font-size:11px; }
  .metric-dimension-count { float:right; margin-top:7px; color:var(--muted); font-size:10.5px; font-variant-numeric:tabular-nums; }
  .metric-dimension-count.issue { color:var(--critical); font-weight:650; }
  .metric-table { padding:2px 13px 8px; }
  .table-scroll { overflow-x:auto; }
  table { width:100%; border-collapse:collapse; font-size:13px; min-width:760px; }
  th { text-align:left; color:var(--muted); font-weight:500; font-size:11px; text-transform:uppercase; letter-spacing:0.05em; padding:0 12px 7px 0; border-bottom:1px solid var(--grid); }
  td { padding:8px 12px 8px 0; border-bottom:1px solid var(--grid); vertical-align:top; }
  tr:last-child td { border-bottom:none; }
  .num, th.num { text-align:right; font-variant-numeric:tabular-nums; white-space:nowrap; }
  .muted { color:var(--muted); }
  .mid { font-size:11px; color:var(--muted); font-family:ui-monospace,monospace; margin-top:1px; }
  .detail { font-size:11.5px; color:var(--muted); margin-top:2px; }
  .prev { font-size:11px; color:var(--muted); font-weight:400; }
  .target { min-width:110px; font-variant-numeric:tabular-nums; }
  .target-threshold { white-space:nowrap; }
  .target-headroom { font-size:10.5px; margin-top:2px; white-space:nowrap; }
  .target-headroom.positive { color:var(--good-text); }
  .target-headroom.negative { color:var(--critical); }
  .lvl { font-size:10px; color:var(--muted); border:1px solid var(--grid); border-radius:4px; padding:0 5px; vertical-align:1px; }
  .star { color:var(--warning); border:1px solid color-mix(in srgb,var(--warning) 45%,transparent); border-radius:4px; padding:0 4px; font-size:9.5px; font-weight:650; }
  .status-good { color:var(--good-text); font-weight:600; white-space:nowrap; }
  .status-warning { color:var(--warning); font-weight:600; white-space:nowrap; }
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
  @media (max-width:560px) { .app { padding:14px 12px 40px; } .metric-summary { grid-template-columns:1fr; } .metric-dimension-copy { width:calc(100% - 84px); } .mb-row { grid-template-columns:minmax(90px,130px) 1fr 56px; } .trend-row { grid-template-columns:1fr 70px 120px; } }
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
