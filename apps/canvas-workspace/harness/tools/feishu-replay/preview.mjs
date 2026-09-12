import { readFile, writeFile } from 'node:fs/promises';
import MarkdownIt from 'markdown-it';

const folder = new URL('../../../.harness/feishu-replay/', import.meta.url);
const trace = JSON.parse(await readFile(new URL('trace.json', folder), 'utf8'));
if (trace.status !== 'passed') throw new Error('Run the replay tests successfully before generating the preview');
const md = new MarkdownIt({ html: false, linkify: false, breaks: true });
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const markdown = value => md.render(value ?? '')
  .replaceAll('&lt;font color=&quot;grey&quot;&gt;', '<span class="muted">')
  .replaceAll('&lt;font color=&quot;red&quot;&gt;', '<span class="error">')
  .replaceAll('&lt;/font&gt;', '</span>');
const supported = new Set(['markdown', 'plain_text', 'collapsible_panel', 'button']);
function render(node, texts) {
  if (!supported.has(node.tag)) throw new Error(`Preview does not support ${node.tag}; add coverage explicitly`);
  if (node.tag === 'button') return `<button class="stop-button" data-stop ${node.disabled ? 'disabled' : ''}>${escape(node.text.content)}</button>`;
  const id = node.element_id ? ` data-element="${escape(node.element_id)}"` : '';
  if (node.tag === 'collapsible_panel') {
    return `<details ${node.expanded ? 'open' : ''}><summary>${render(node.header.title, texts)}</summary><div class="timeline">${node.elements.map(child => render(child, texts)).join('')}</div></details>`;
  }
  const content = node.tag === 'markdown' ? markdown(node.content) : escape(node.content);
  if (node.element_id) texts[node.element_id] = content;
  return `<div class="text ${escape(node.text_size ?? 'normal')}"${id}>${content}</div>`;
}
for (const scenario of trace.scenarios) {
  for (const frame of scenario.frames) {
    frame.texts = {};
    frame.renderedCards = frame.cards.map(({ messageId, card }) => ({ messageId, html: card.body.elements.map(node => render(node, frame.texts)).join('') }));
    frame.html = frame.renderedCards.map(({ messageId, html }) => `<div class="message" data-message="${escape(messageId)}"><div class="sender"><span class="avatar">P</span>Pulse <span class="bot">测试回放</span></div><article class="message-card">${html}</article></div>`).join('');
  }
}
const css = await readFile(new URL('preview.css', import.meta.url), 'utf8');
const js = await readFile(new URL('preview-client.js', import.meta.url), 'utf8');
const data = JSON.stringify(trace).replaceAll('<', '\\u003c');
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; connect-src 'none'">
<title>飞书卡片 · 离线回放</title><style>${css}</style>
<body><main><header><span class="eyebrow">PULSE / CHANNEL TEST</span><h1>飞书卡片 · 离线回放</h1>
<p>真实发送代码产生的请求记录。渲染由本地模拟器完成，无登录、无网络请求。</p></header>
<section class="controls" aria-label="回放控制"><label>场景 <select id="scenario" aria-label="场景"></select></label>
<div class="buttons"><button id="reset">回到开始</button><button id="play">播放</button><button id="next">下一步</button><button id="end">完成状态</button><button id="width">切到 375px</button><button id="verify">检查全部场景</button></div>
<label class="scrubber">事件 <input id="position" type="range" min="0" value="0"><output id="clock"></output></label></section>
<div class="coverage"><strong>已验证：</strong>真实请求路径、更新顺序、失败恢复、最终内容。<br><strong>未验证：</strong>飞书官方样式与动画、服务端完整校验及真实权限。此页不模拟原生 loading 动画。</div>
<pre id="checks" aria-live="polite" hidden></pre><div id="note" role="note"></div><section class="stage"><div id="conversation"><div id="card"></div><div id="fallback"></div></div></section>
<footer><span id="operation"></span><span id="native"></span></footer>
<details class="requests"><summary>查看当前卡片 JSON</summary><pre id="json"></pre></details>
</main><script id="trace" type="application/json">${data}</script><script>${js}</script></body></html>`;
await writeFile(new URL('index.html', folder), html);
console.log(`Offline preview: ${new URL('index.html', folder).pathname}`);
