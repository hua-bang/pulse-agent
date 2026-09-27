import type { DefaultSkill } from './default-skills';

/**
 * Style guide for generated visuals. It used to be inlined in every workspace
 * system prompt (~3.3k tokens) although only visual turns need it; the prompt
 * now keeps the tool-choice rules and tells the agent to load this skill
 * before writing visual HTML/SVG.
 */
export const VISUAL_STYLE_SKILL: DefaultSkill = {
  slug: 'visual-style',
  name: 'visual-style',
  description:
    'Load before writing HTML or SVG for visual_render or artifact_create: archetype router (step, dashboard, schema, comparison, timeline, architecture, concept), density rules, and shared CSS tokens.',
  body: `# visual-style

Style guide for the HTML/SVG you pass to \`visual_render\` (inline) or \`artifact_create\` (side drawer). Pick the right archetype, then match documentation density.

\`visual_render\` is **inline in the chat**. Information density is welcome; decorative chrome is not (no marketing hero, no gradients, no glowing CTAs). Within that, the **register varies by archetype**:
- Step / Schema / Comparison / Timeline / Architecture / Concept → "thoughtful product documentation" (Notion / Linear / Stripe docs / a great README). Muted, monochrome-leaning, restrained.
- **Dashboard / Monitoring** → "operations console" (Datadog / Grafana / a Linear status page). KPIs are **content-colored and loud**; numbers, deltas, severity pills carry meaning through color. Still no gradients or marketing chrome, but information IS allowed to shout when it's status.

Producing the right look means picking the right *archetype* for the content first, then matching that archetype's register.

**Do not default to a flow diagram.** Step boxes + ↓ arrows is ONE archetype, not THE archetype. Before generating, pick from the list below using the user's intent.

## Archetype router (pick one before writing any CSS)

| User intent / verbs | Archetype | Looks like |
| --- | --- | --- |
| "流程"/"加工"/"pipeline"/"step by step"/"how X flows" | **Step diagram** | vertical stacked pastel boxes + ↓ arrows |
| "监控"/"dashboard"/"运营总览"/"健康状态"/"metrics overview" | **Dashboard** | KPI tiles row + chart(s) + status table |
| "schema"/"数据模型"/"字段"/"表结构"/"data spec" | **Schema spec** | titled card with field rows (name · type · note) |
| "对比"/"compare"/"vs"/"feature matrix" | **Comparison matrix** | grid table with row/column headers |
| "时间线"/"roadmap"/"history"/"timeline" | **Timeline** | horizontal axis with milestones, or vertical date-stacked entries |
| "架构"/"system"/"模块关系"/"components" | **Architecture map** | grouped boxes with labeled connections, optional swimlanes |
| "概念图"/"mindmap"/"taxonomy" | **Concept tree** | radial or indented tree |

When the user's request fits two archetypes, prefer the **richer** one (e.g. "可视化加工逻辑" can be a step diagram OR a pipeline spec with step boxes + per-stage field/QC rows — the spec form carries more information and is usually what the user actually wants).

## Soft rules (apply to all archetypes)

Allowed within reason:
- **Subtle elevation**: \`box-shadow: 0 1px 2px rgba(15,23,42,.04)\` on cards/tiles. Stronger shadows still off-limits.
- **Status / severity color** when the data has status semantics (alerts, health, severity, change vs. baseline). Use the status palette below.
- **Multiple category colors** when the categories are content-driven (regions, services, severity tiers, owners). Cap at ~6 hues; pick from a coherent scale (slate/blue/indigo/violet/emerald/amber), never neon.
- **Inline charts**: Chart.js or D3 are fine. Series can use distinct hues when they represent distinct categories.
- **Status pills / badges** with colored backgrounds when they label real state. Use the status palette below.
- **Small numeric callouts** (KPI tiles) with one accent-colored number per tile.

Still off-limits (these break the inline register):
- Gradient backgrounds anywhere
- Glows, heavy drop shadows, or any shadow stronger than the subtle elevation above
- Border-radius > 14px, oversized hero headers, full-bleed colored banners
- Decorative emoji clouds, marketing-style CTA buttons, animated/looping effects
- Nested bordered cards (a card inside a card inside a card)
- Rainbow palettes used for decoration rather than meaning

## Shared tokens

\`\`\`css
*{box-sizing:border-box}
body{margin:0;font:14px/1.5 -apple-system,BlinkMacSystemFont,Inter,system-ui,sans-serif;color:#1e293b;background:transparent}
/* Type */
.t-title{font-weight:600;font-size:15px;color:#0f172a}
.t-label{font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.04em}
.t-muted{font-size:13px;color:#64748b}
/* Surface */
.card{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:14px}
.card--soft{background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px}
.elev{box-shadow:0 1px 2px rgba(15,23,42,.04)}
/* Accent (pick one per visual, default indigo) */
:root{--accent:#6366f1;--accent-soft:#eef2ff}
/* Status palette — use for severity / health pills, status dots */
.s-ok{color:#047857;background:#ecfdf5;border:1px solid #a7f3d0}
.s-warn{color:#a16207;background:#fef9c3;border:1px solid #fde68a}
.s-err{color:#b91c1c;background:#fee2e2;border:1px solid #fecaca}
.s-info{color:#1d4ed8;background:#eff6ff;border:1px solid #bfdbfe}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%}
.dot-ok{background:#10b981}.dot-warn{background:#f59e0b}.dot-err{background:#ef4444}
.pulse{animation:pulse 1.8s ease-in-out infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}
/* KPI — for dashboard tiles. Number takes content-meaning color. */
.kpi{position:relative;padding:14px 16px}
.kpi-name{font-size:12px;color:#64748b;font-weight:500;margin-bottom:6px}
.kpi-num{font-size:32px;font-weight:700;line-height:1.1;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.kpi-unit{font-size:14px;font-weight:600;color:inherit;margin-left:2px}
.kpi-num--ok{color:#059669}.kpi-num--warn{color:#d97706}.kpi-num--err{color:#dc2626}
.kpi-num--neutral{color:#4f46e5}.kpi-num--info{color:#0891b2}
.kpi-delta{display:inline-flex;align-items:center;gap:4px;font-size:12px;margin-top:8px;padding:2px 8px;border-radius:999px;font-weight:500}
.kpi-delta--good{color:#047857;background:#ecfdf5}
.kpi-delta--bad{color:#b91c1c;background:#fee2e2}
.kpi-delta--info{color:#1d4ed8;background:#eff6ff}
.kpi-delta--warn{color:#a16207;background:#fef9c3}
/* Optional thin accent rule under the metric name, in the number's color */
.kpi-rule{height:2px;border-radius:1px;margin:0 0 10px 0;width:32px}
\`\`\`

Keep \`<body>\` transparent and width auto-fitting; don't set a fixed pixel width. For the **dashboard** archetype only, a very faint warm body tint (\`background:#fafaf9\`) is acceptable if it helps the cards read.

## Archetype anchors (use these as starting points, don't copy verbatim)

**Step diagram** (when archetype router picked "Step diagram"):
- Vertical stack of step boxes, ↓ arrow (or thin SVG line) between them
- Step box: pastel fill, 1px border same hue 1-step darker, radius 8px, padding 14-18px
- Stage palette (sparingly, ≤4 categories): input \`#eff6ff/#bfdbfe\`, process \`#f1f5f9/#cbd5e1\`, decision \`#fef3c7/#fde68a\`, output \`#ecfdf5/#a7f3d0\`
- Numbered marker ①②③ in muted grey \`#94a3b8\` on the LEFT margin, NOT inside the box
- For "process logic" requests with fields/QC info, consider upgrading to a step-spec variant: each step box stacks a header row + small \`.t-label\` field list (inputs, outputs, QC fields)

**Dashboard** (monitoring, operational overview):
- Register: "operations console", not "documentation diagram". KPIs should feel **alive and color-coded**, not muted. Numbers are LOUD, chrome is QUIET.
- **Header row**: title (18-20px bold) on the left; on the right, an inline "live" line — pulse dot + \`实时监控\` (or \`Live\`) + \`·\` separators + \`最后更新 HH:MM:SS\` + \`刷新 30s\`. Use \`.dot-ok\` + \`.pulse\` for the indicator. Subtitle (\`.t-muted\`) under the title shows scope (\`生产环境 · 最近 24 小时\`).
- **KPI row** (3-5 tiles, CSS grid \`repeat(auto-fit,minmax(170px,1fr))\`, gap 12-14px):
  - Each tile uses \`.card\` + \`.elev\` (or just \`.kpi\` on a soft surface — either is fine).
  - Structure (top to bottom): \`.kpi-name\` metric label → optional \`.kpi-rule\` thin colored bar (in number's color) → \`.kpi-num\` BIG bold number with semantic color (\`--ok\` / \`--warn\` / \`--err\` / \`--neutral\` / \`--info\`) → \`.kpi-delta\` rounded pill with ▲ / ▼ + delta value + " vs 昨日" or " vs baseline".
  - **Pick the number's color by what the metric *means***, not by accent rules: uptime/SLA/success rate → \`--ok\` (green); latency / queue depth → \`--warn\` (amber) if elevated else \`--neutral\`; alerts / 5xx / errors → \`--err\` (red); counts / instances → \`--neutral\` (indigo).
  - Pick the delta's color by **whether the change is good or bad**, not by direction: "↑0.03% 可用性" is \`--good\` even though it's an "up" arrow; "↑22ms 延迟" is \`--bad\` because higher latency is worse.
- **Chart row** (1-2 cards side-by-side, CSS grid 2fr 1fr is a common split):
  - Time series → Chart.js line/area, dual-axis OK (e.g. QPS on left, 5xx% on right). Series colors: primary \`#6366f1\` (indigo), secondary \`#ef4444\` (rose) for "bad" series, tertiary \`#10b981\` (emerald) for "good" series.
  - Composition / resource → labeled horizontal bars (one row per resource with name + colored bar + % label), OR Chart.js doughnut with side legend; bars often read better inline.
  - Distribution / ranked categories → horizontal bars with category-distinct hues from {indigo, violet, sky, emerald, amber, rose}.
- **Bottom row** (typically 2 columns):
  - Left: **service health list** — each row = colored \`.dot-*\` + service name + tiny metric line below (\`.t-muted\` p95/uptime), with right-aligned \`.s-*\` status pill (\`正常\` / \`降级风险\` / \`异常\`).
  - Right: **alert table** — columns: 告警/服务 · 级别 (severity pill: P1 \`.s-err\`, P2 \`.s-warn\`, P3 \`.s-info\`) · 负责人 · 状态 (status pill: \`处理中\` \`.s-warn\`, \`已恢复\` \`.s-ok\`, \`待处理\` \`.s-info\`). Use mono font for alert IDs.
- Outer container max-width ~1100px, gap 14-16px between rows. Cards radius 10-12px with \`.elev\`. Don't pad cards beyond 16px.
- **Density is the point.** A dashboard with 5 KPIs + 2 charts + 2 tables is correct; a dashboard with 3 KPIs and a lot of whitespace looks anemic.

Minimal KPI tile structure (copy-adapt, don't paste verbatim):
\`\`\`html
<div class="card elev kpi">
  <div class="kpi-name">可用性 SLA</div>
  <div class="kpi-rule" style="background:#059669"></div>
  <div class="kpi-num kpi-num--ok">99.96<span class="kpi-unit">%</span></div>
  <div class="kpi-delta kpi-delta--good">▲ 0.03% vs 昨日</div>
</div>
\`\`\`

**Schema spec** (data model, field list, table structure):
- Single \`.card\` per entity: header row (entity name + small \`.t-label\` for kind/source), then a table-ish field list
- Field row: \`name\` (mono, 13px) · \`type\` (\`.t-label\`) · description (\`.t-muted\`); optional right-aligned constraint pill
- Use \`.s-info\` pills for "PK" / "FK" / "nullable" / "index" markers, monochrome otherwise
- No charts; this archetype is text-dense by design

**Comparison matrix**:
- HTML table or CSS grid with sticky first column for row labels
- Header row in \`.t-label\` style, alternating row stripe \`#f8fafc\` for readability
- Cells: ✓/✗ Unicode or status pills, never decorative icons
- Caption (if any) in \`.t-muted\` above the table

**Timeline**:
- Vertical preferred for inline (horizontal often overflows the chat column)
- Left rail with date \`.t-label\` + dot, right side with title + \`.t-muted\` description
- Optional accent-colored connecting line between dots

**Architecture map**:
- Use CSS grid or absolutely-positioned cards inside a relative container
- Group related boxes with a parent \`.card--soft\` and a tiny header label
- Connections: thin SVG lines with arrowheads in \`#94a3b8\`, optional inline label

**Concept tree / mindmap**:
- Indented list with vertical guide lines, OR a small D3 radial tree
- Keep depth ≤3; flatten further branches into a "siblings" list

## When in doubt

If the user request mentions multiple intents ("可视化加工流程，包含字段说明和质控指标"), combine archetypes — usually step diagram + per-step field rows, or dashboard + alert table. Combining two archetypes is preferable to picking one and dropping information.

\`artifact_create\` may go further toward product-quality polish (subtle gradients on hero, brand color, slightly stronger shadows) since it lives in the side drawer; \`visual_render\` stays at documentation density.
`,
};
