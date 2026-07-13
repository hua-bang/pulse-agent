// Synthetic 86-node canvas matching the sanitized real-user profile:
// 19 frames, 40 iframe/link nodes (25 external-like static pages, 8 local
// interactive HTML, 7 mermaid-like animated SVG), 14 text (13 + 1 standing in
// for the agent node, which needs PTY/main-process), 8 markdown files,
// 3 images, 2 mindmaps. All iframes are mode:'html' (srcdoc) — in Electron the
// 25 external ones would be <webview> guests; plain Chromium can't host
// <webview>, so this rig measures the inline-iframe class faithfully and uses
// static pages as stand-ins for the external ones.

const staticPage = (i) => [
  '<!doctype html><html><body style="margin:0;font:13px system-ui;padding:14px;background:#0b1220;color:#e2e8f0">',
  `<h3>External page stand-in #${i}</h3>`,
  '<table style="width:100%;border-collapse:collapse">',
  Array.from({ length: 40 }, (_, r) =>
    `<tr><td style="padding:3px;border-bottom:1px solid #1e293b">row ${r}</td><td style="padding:3px;border-bottom:1px solid #1e293b">${(r * 37) % 100}%</td><td style="padding:3px;border-bottom:1px solid #1e293b;background:hsl(${(r * 23) % 360},60%,30%)"></td></tr>`).join(''),
  '</table></body></html>',
].join('');

const interactivePage = (i, animated) => [
  '<!doctype html><html><body style="margin:0;font:13px system-ui;padding:10px;background:#111827;color:#f3f4f6">',
  `<h4>Interactive viz #${i}</h4><div id="s">-</div><canvas id="c" width="360" height="240"></canvas>`,
  '<script>',
  'new ResizeObserver(() => { document.title = document.body.offsetHeight; }).observe(document.documentElement);',
  animated ? [
    'const ctx = document.getElementById("c").getContext("2d"); let t = 0;',
    'const draw = () => { t++; ctx.fillStyle = "#111827"; ctx.fillRect(0,0,360,240);',
    'for (let k = 0; k < 60; k++) { ctx.fillStyle = `hsl(${(k*13+t)%360},70%,50%)`;',
    'ctx.beginPath(); ctx.arc(20+(k%10)*34, 24+Math.floor(k/10)*38+Math.sin((t+k)/9)*8, 9, 0, 6.3); ctx.fill(); }',
    'requestAnimationFrame(draw); }; requestAnimationFrame(draw);',
    'setInterval(() => { document.getElementById("s").textContent = "poll tick " + Date.now(); }, 250);',
  ].join('') : '',
  '</script></body></html>',
].join('');

const mermaidPage = (i, animated) => [
  '<!doctype html><html><head><style>',
  animated ? '@keyframes dash { to { stroke-dashoffset: -100; } } .edge { stroke-dasharray: 6 4; animation: dash 1.2s linear infinite; }' : '',
  '</style></head><body style="margin:0;background:#fff;font:12px system-ui">',
  `<h4 style="margin:8px">Flow diagram #${i}</h4><svg width="440" height="300">`,
  Array.from({ length: 12 }, (_, k) => {
    const x = 20 + (k % 4) * 105, y = 30 + Math.floor(k / 4) * 90;
    return `<rect x="${x}" y="${y}" width="90" height="44" rx="6" fill="#eef2ff" stroke="#6366f1"/>` +
      `<text x="${x + 12}" y="${y + 26}">step ${k}</text>` +
      (k < 11 ? `<line class="edge" x1="${x + 90}" y1="${y + 22}" x2="${x + 105}" y2="${y + 22}" stroke="#6366f1" stroke-width="2"/>` : '');
  }).join(''),
  '</svg><script>',
  'new ResizeObserver(() => {}).observe(document.documentElement);',
  animated ? 'const svg = document.querySelector("svg"); setInterval(() => { svg.setAttribute("data-tick", Date.now()); }, 500); new MutationObserver(() => {}).observe(svg, { attributes: true });' : '',
  '</script></body></html>',
].join('');

const MD = Array.from({ length: 30 }, (_, r) => `## Section ${r}\n\nParagraph with some **bold** and \`code\` content, row ${r}.\n`).join('\n');

export const buildFixture = (variant) => {
  const animated = variant === 'full';
  const iframesAsText = variant === 'no-iframes';
  const nodes = [];
  const now = Date.now();
  let topicSeq = 0;
  const topic = (text, children = []) => ({ id: `t${topicSeq++}`, text, children });

  const FRAME_W = 1200, FRAME_H = 850, STRIDE_X = 1450, STRIDE_Y = 1050;
  for (let f = 0; f < 19; f++) {
    nodes.push({
      id: `frame-${f}`, type: 'frame', title: `阶段 ${f + 1}`,
      x: 100 + (f % 5) * STRIDE_X, y: 100 + Math.floor(f / 5) * STRIDE_Y,
      width: FRAME_W, height: FRAME_H, updatedAt: now,
      data: { color: 'oklch(0.68 0.108 224)' },
    });
  }
  const slot = (f, s) => ({
    x: 100 + (f % 5) * STRIDE_X + 40 + (s % 2) * 580,
    y: 100 + Math.floor(f / 5) * STRIDE_Y + 60 + Math.floor(s / 2) * 400,
  });

  let frameCursor = 0, slotCursor = 0;
  const nextSlot = () => {
    const p = slot(frameCursor, slotCursor);
    slotCursor++;
    if (slotCursor >= 4) { slotCursor = 0; frameCursor = (frameCursor + 1) % 19; }
    return p;
  };

  for (let i = 0; i < 40; i++) {
    const p = nextSlot();
    const html = i < 25 ? staticPage(i) : i < 33 ? interactivePage(i, animated) : mermaidPage(i, animated);
    if (iframesAsText) {
      nodes.push({ id: `if-${i}`, type: 'text', title: `link ${i}`, x: p.x, y: p.y, width: 520, height: 360, updatedAt: now,
        data: { content: `placeholder for iframe ${i}`, textColor: '#1f2328', backgroundColor: 'transparent', fontSize: 18, autoSize: false } });
    } else {
      nodes.push({ id: `if-${i}`, type: 'iframe', title: i < 25 ? `外部页 ${i}` : i < 33 ? `本地可视化 ${i}` : `流程图 ${i}`,
        x: p.x, y: p.y, width: 520, height: 360, updatedAt: now,
        data: { url: '', mode: 'html', html, prompt: '' } });
    }
  }
  for (let i = 0; i < 14; i++) {
    const p = nextSlot();
    nodes.push({ id: `tx-${i}`, type: 'text', title: `笔记 ${i}`, x: p.x, y: p.y, width: 260, height: 150, updatedAt: now,
      data: { content: `note ${i}: 一些说明文字,换行\n第二行内容`, textColor: '#1f2328', backgroundColor: 'transparent', fontSize: 18, autoSize: false } });
  }
  for (let i = 0; i < 8; i++) {
    const p = nextSlot();
    nodes.push({ id: `md-${i}`, type: 'file', title: `doc-${i}.md`, x: p.x, y: p.y, width: 420, height: 340, updatedAt: now,
      data: { filePath: '', content: MD, saved: true, modified: false } });
  }
  for (let i = 0; i < 3; i++) {
    const p = nextSlot();
    nodes.push({ id: `img-${i}`, type: 'image', title: `图 ${i}`, x: p.x, y: p.y, width: 260, height: 190, updatedAt: now,
      data: { filePath: '' } });
  }
  for (let i = 0; i < 2; i++) {
    const p = nextSlot();
    nodes.push({ id: `mm-${i}`, type: 'mindmap', title: `导图 ${i}`, x: p.x, y: p.y, width: 460, height: 320, updatedAt: now,
      data: { root: topic(`主题 ${i}`, [topic('分支 A', [topic('叶 1'), topic('叶 2')]), topic('分支 B'), topic('分支 C')]), layout: 'right', rev: 0 } });
  }
  return { nodes, edges: [], transform: { x: 0, y: 0, scale: 1 } };
};
