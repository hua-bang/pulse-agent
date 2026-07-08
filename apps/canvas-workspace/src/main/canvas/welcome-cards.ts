/**
 * Shared design system + template builders for the onboarding HTML cards.
 *
 * One visual identity across all eight cards, derived from the host app's
 * light UI: blue-biased ink neutrals, the product's pulse-blue accent, a
 * dot-grid "canvas" motif for diagram surfaces, system font stack for text
 * and ui-monospace for eyebrows/kbd/step numbers. The cards commit to a
 * single light theme on purpose — they render inside the app's light-only
 * canvas chrome, not in a standalone browser tab.
 *
 * Locale files pass copy only; markup and CSS live here so zh/en cannot
 * drift apart visually.
 */

const CSS = `
*{box-sizing:border-box;margin:0}
html,body{height:100%}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;color:#1B2130;-webkit-font-smoothing:antialiased;font-size:14px;line-height:1.55}
.card{height:100%;display:flex;flex-direction:column;padding:20px 24px;background:#FBFBFC;overflow:auto}
.eyebrow{font-family:ui-monospace,'SF Mono',Menlo,Consolas,monospace;font-size:10.5px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:#3A63F2;margin-bottom:6px}
h2{font-size:19px;font-weight:700;letter-spacing:-.02em;text-wrap:balance;margin-bottom:14px}
.muted{color:#5B6472;font-size:12.5px}
kbd{font-family:ui-monospace,'SF Mono',Menlo,Consolas,monospace;font-size:11px;background:#fff;border:1px solid #D7DCE5;border-bottom-width:2px;border-radius:5px;padding:2px 6px;white-space:nowrap;color:#1B2130}
.mono{font-family:ui-monospace,'SF Mono',Menlo,Consolas,monospace}
`;

const doc = (extra: string, body: string): string =>
  `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}${extra}</style></head><body>${body}</body></html>`;

/** Minimal 24×24 stroke icons; keyed so locale files stay text-only. */
const ICONS: Record<string, string> = {
  note: '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/><path d="M10 12h5M10 16h5"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17"/><path d="M12 3.5c2.9 2.6 2.9 14.4 0 17-2.9-2.6-2.9-14.4 0-17z"/>',
  mindmap: '<circle cx="6" cy="12" r="2.4"/><circle cx="17" cy="6" r="2.4"/><circle cx="17" cy="18" r="2.4"/><path d="M8.3 11l6.2-4M8.3 13l6.2 4"/>',
  chat: '<path d="M5 5.5h14a1 1 0 0 1 1 1V15a1 1 0 0 1-1 1H10l-5 4V6.5a1 1 0 0 1 1-1z"/>',
  terminal: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M7.5 9.5l3 3-3 3M13 15.5h4"/>',
  frame: '<path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4"/><circle cx="12" cy="12" r="1.4"/>',
};

const icon = (key: string): string =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[key] ?? ''}</svg>`;

export interface HeroCopy {
  /** Two-part wordmark; the second word gets the accent color. */
  nameA: string;
  nameB: string;
  tagline: string;
  chips: string[];
  /** Labels inside the mini-canvas vignette. */
  frameLabel: string;
  nodeA: string;
  nodeB: string;
}

export const heroCard = (c: HeroCopy): string =>
  doc(
    `
.hero{height:100%;display:flex;align-items:center;gap:12px;padding:0 16px 0 42px;background:#FBFBFC;background-image:radial-gradient(#DFE4EE 1px,transparent 1px);background-size:18px 18px}
.hl{flex:1;min-width:0}
.wm{font-size:40px;font-weight:750;letter-spacing:-.03em;line-height:1.1}
.wm b{color:#3A63F2}
.tag{margin-top:8px;font-size:16px;color:#5B6472}
.chips{display:flex;gap:8px;margin-top:18px;flex-wrap:wrap}
.chip{font-family:ui-monospace,'SF Mono',Menlo,monospace;font-size:11px;letter-spacing:.05em;padding:5px 12px;border:1px solid #C9D4F5;color:#3A63F2;border-radius:999px;background:#fff}
.stage{position:relative;width:300px;height:220px;flex:none}
.stage svg{position:absolute;inset:0}
.pulse{position:absolute;left:-5px;top:-5px;width:10px;height:10px;border-radius:50%;background:#3A63F2;box-shadow:0 0 0 4px rgba(58,99,242,.16);offset-path:path('M138 150 C 168 150 152 90 180 90');animation:travel 3.2s ease-in-out infinite}
@keyframes travel{0%{offset-distance:0%;opacity:0}14%{opacity:1}86%{opacity:1}100%{offset-distance:100%;opacity:0}}
@media (prefers-reduced-motion:reduce){.pulse{animation:none;offset-distance:100%}}
`,
    `<div class="hero"><div class="hl">
<div class="wm">${c.nameA} <b>${c.nameB}</b></div>
<p class="tag">${c.tagline}</p>
<div class="chips">${c.chips.map((chip) => `<span class="chip">${chip}</span>`).join('')}</div>
</div>
<div class="stage">
<svg viewBox="0 0 300 220" fill="none">
<rect x="12" y="24" width="276" height="180" rx="14" stroke="#B9C3D9" stroke-width="1.5" stroke-dasharray="6 5"/>
<text x="28" y="46" font-size="10" letter-spacing="1.5" fill="#8B93A3" font-family="ui-monospace,Menlo,monospace">${c.frameLabel}</text>
<rect x="28" y="120" width="110" height="60" rx="10" fill="#fff" stroke="#C7CEDC" stroke-width="1.5"/>
<text x="83" y="155" font-size="12" text-anchor="middle" fill="#1B2130">${c.nodeA}</text>
<rect x="180" y="60" width="96" height="60" rx="10" fill="#fff" stroke="#C7CEDC" stroke-width="1.5"/>
<text x="228" y="95" font-size="12" text-anchor="middle" fill="#1B2130">${c.nodeB}</text>
<path d="M138 150 C 168 150 152 90 180 90" stroke="#3A63F2" stroke-width="1.8"/>
</svg>
<div class="pulse"></div>
</div></div>`,
  );

export interface FeatureItem {
  icon: string;
  title: string;
  desc: string;
}

export const featureGrid = (eyebrow: string, heading: string, items: FeatureItem[]): string =>
  doc(
    `
.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;flex:1;min-height:0}
.tile{background:#fff;border:1px solid #E5E9F1;border-radius:12px;padding:14px 16px;display:flex;gap:12px;align-items:flex-start;transition:transform .15s,box-shadow .15s}
.tile:hover{transform:translateY(-2px);box-shadow:0 6px 16px rgba(27,33,48,.08)}
.ic{flex:none;width:34px;height:34px;border-radius:9px;background:#EDF1FD;color:#3A63F2;display:flex;align-items:center;justify-content:center}
.ic svg{width:18px;height:18px}
.tile h3{font-size:14px;font-weight:650;margin-bottom:3px;letter-spacing:-.01em}
.tile p{font-size:12.5px;color:#5B6472;line-height:1.5}
`,
    `<div class="card"><div class="eyebrow">${eyebrow}</div><h2>${heading}</h2>
<div class="grid">${items
      .map(
        (it) =>
          `<div class="tile"><div class="ic">${icon(it.icon)}</div><div><h3>${it.title}</h3><p>${it.desc}</p></div></div>`,
      )
      .join('')}</div></div>`,
  );

export interface ConceptCopy {
  eyebrow: string;
  heading: string;
  frameLabel: string;
  nodeA: string;
  nodeB: string;
  edgeLabel: string;
  caps: Array<{ term: string; desc: string }>;
}

export const conceptCard = (c: ConceptCopy): string =>
  doc(
    `
.panel{position:relative;flex:1;min-height:0;border:1px solid #E5E9F1;border-radius:12px;background:#fff;background-image:radial-gradient(#E3E7F0 1px,transparent 1px);background-size:16px 16px;overflow:hidden}
.panel svg{width:100%;height:100%}
.caps{display:flex;gap:10px;margin-top:12px}
.caps>div{flex:1;background:#fff;border:1px solid #E5E9F1;border-radius:10px;padding:9px 12px}
.caps b{display:block;font-size:13px;letter-spacing:-.01em}
.caps span{font-size:12px;color:#5B6472}
`,
    `<div class="card"><div class="eyebrow">${c.eyebrow}</div><h2>${c.heading}</h2>
<div class="panel"><svg viewBox="0 0 660 210" fill="none" preserveAspectRatio="xMidYMid meet">
<rect x="16" y="14" width="628" height="182" rx="14" stroke="#B9C3D9" stroke-width="1.5" stroke-dasharray="7 5"/>
<text x="36" y="40" font-size="11" letter-spacing="1.5" fill="#8B93A3" font-family="ui-monospace,Menlo,monospace">${c.frameLabel}</text>
<rect x="72" y="78" width="160" height="64" rx="11" fill="#fff" stroke="#C7CEDC" stroke-width="1.5"/>
<text x="152" y="115" font-size="14" text-anchor="middle" fill="#1B2130">${c.nodeA}</text>
<rect x="428" y="78" width="160" height="64" rx="11" fill="#fff" stroke="#C7CEDC" stroke-width="1.5"/>
<text x="508" y="115" font-size="14" text-anchor="middle" fill="#1B2130">${c.nodeB}</text>
<defs><marker id="ah" markerWidth="9" markerHeight="8" refX="8" refY="4" orient="auto"><path d="M0 0 L9 4 L0 8 z" fill="#3A63F2"/></marker></defs>
<path d="M232 110 C 300 110 360 110 423 110" stroke="#3A63F2" stroke-width="2" marker-end="url(#ah)"/>
<text x="328" y="98" font-size="11.5" text-anchor="middle" fill="#3A63F2" font-family="ui-monospace,Menlo,monospace">${c.edgeLabel}</text>
</svg></div>
<div class="caps">${c.caps.map((cap) => `<div><b>${cap.term}</b><span>${cap.desc}</span></div>`).join('')}</div>
</div>`,
  );

export interface TableRow {
  label: string;
  /** May contain <kbd> markup. */
  value: string;
}

export const tableCard = (eyebrow: string, heading: string, rows: TableRow[], footer?: string): string =>
  doc(
    `
.rows{display:flex;flex-direction:column;flex:1}
.row{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:8px 2px;border-bottom:1px solid #ECEFF4;font-size:13.5px}
.row:last-child{border-bottom:0}
.k{color:#5B6472}
.v{text-align:right;font-variant-numeric:tabular-nums}
.foot{margin-top:10px}
`,
    `<div class="card"><div class="eyebrow">${eyebrow}</div><h2>${heading}</h2>
<div class="rows">${rows.map((r) => `<div class="row"><span class="k">${r.label}</span><span class="v">${r.value}</span></div>`).join('')}</div>
${footer ? `<p class="muted foot">${footer}</p>` : ''}</div>`,
  );

export interface KanbanColumn {
  /** Status dot color (hex). */
  dot: string;
  label: string;
  items: string[];
}

export const kanbanCard = (eyebrow: string, heading: string, cols: KanbanColumn[], hint: string): string =>
  doc(
    `
.cols{display:flex;gap:10px;flex:1;min-height:0}
.col{flex:1;background:#F2F4F8;border-radius:12px;padding:10px;display:flex;flex-direction:column;gap:8px}
.colh{display:flex;align-items:center;gap:6px;font-family:ui-monospace,'SF Mono',Menlo,monospace;font-size:10.5px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:#5B6472;padding:2px 2px 3px}
.dotc{width:8px;height:8px;border-radius:50%;flex:none}
.item{background:#fff;border:1px solid #E5E9F1;border-radius:9px;padding:9px 11px;font-size:12.5px;box-shadow:0 1px 2px rgba(27,33,48,.04)}
.hint{margin-top:12px}
`,
    `<div class="card"><div class="eyebrow">${eyebrow}</div><h2>${heading}</h2>
<div class="cols">${cols
      .map(
        (col) =>
          `<div class="col"><div class="colh"><span class="dotc" style="background:${col.dot}"></span>${col.label}</div>${col.items
            .map((item) => `<div class="item">${item}</div>`)
            .join('')}</div>`,
      )
      .join('')}</div>
<p class="muted hint">${hint}</p></div>`,
  );

export interface ChatBubble {
  who: 'user' | 'ai';
  /** May contain <ol>/<li>/<br> markup. */
  html: string;
}

export const chatMockCard = (eyebrow: string, bubbles: ChatBubble[], hint: string): string =>
  doc(
    `
.chat{display:flex;flex-direction:column;gap:10px;flex:1;overflow:auto;padding:2px 0}
.b{max-width:86%;padding:10px 14px;border-radius:14px;font-size:13px;line-height:1.6}
.u{align-self:flex-end;background:#3A63F2;color:#fff;border-bottom-right-radius:4px}
.a{align-self:flex-start;background:#fff;border:1px solid #E5E9F1;border-bottom-left-radius:4px}
.a ol{margin:6px 0 0;padding-left:20px}
.a li{margin:2px 0}
.hint{margin-top:10px;text-align:center}
`,
    `<div class="card"><div class="eyebrow">${eyebrow}</div>
<div class="chat">${bubbles.map((b) => `<div class="b ${b.who === 'user' ? 'u' : 'a'}">${b.html}</div>`).join('')}</div>
<p class="muted hint">${hint}</p></div>`,
  );

export interface WorkflowStep {
  n: string;
  label: string;
}

export const workflowCard = (
  eyebrow: string,
  heading: string,
  steps: WorkflowStep[],
  loopText: string,
  notes: string[],
): string =>
  doc(
    `
.steps{display:flex;gap:8px;align-items:stretch}
.step{flex:1;background:#fff;border:1px solid #E5E9F1;border-radius:12px;padding:12px 8px;text-align:center}
.n{display:block;font-family:ui-monospace,'SF Mono',Menlo,monospace;font-size:10.5px;font-weight:600;letter-spacing:.1em;color:#3A63F2;margin-bottom:4px}
.step b{font-size:13px;letter-spacing:-.01em}
.arr{align-self:center;color:#A9B2C2;font-size:15px}
.loop{margin:4px 0 2px}
.loop svg{width:100%;height:44px;display:block}
.loopcap{text-align:center;font-family:ui-monospace,'SF Mono',Menlo,monospace;font-size:11px;color:#3A63F2;margin-bottom:8px}
ul{margin-top:auto;padding-left:18px;color:#5B6472;font-size:12.5px;line-height:1.8}
`,
    `<div class="card"><div class="eyebrow">${eyebrow}</div><h2>${heading}</h2>
<div class="steps">${steps
      .map((s) => `<div class="step"><span class="n">${s.n}</span><b>${s.label}</b></div>`)
      .join('<div class="arr">→</div>')}</div>
<div class="loop"><svg viewBox="0 0 600 44" fill="none" preserveAspectRatio="none">
<defs><marker id="la" markerWidth="8" markerHeight="7" refX="7" refY="3.5" orient="auto"><path d="M0 0 L8 3.5 L0 7 z" fill="#3A63F2"/></marker></defs>
<path d="M560 4 C 560 36 40 36 40 8" stroke="#3A63F2" stroke-width="1.6" stroke-dasharray="5 4" marker-end="url(#la)"/>
</svg></div>
<div class="loopcap">${loopText}</div>
<ul>${notes.map((n) => `<li>${n}</li>`).join('')}</ul></div>`,
  );
