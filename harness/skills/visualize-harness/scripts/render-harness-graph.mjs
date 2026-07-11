#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAllScopeGraphs, createScopeGraph } from './scope-graphs.mjs';

function fail(message) {
  throw new Error(`Invalid harness graph: ${message}`);
}

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
}

function requireString(value, label) {
  if (typeof value !== 'string' || !value.trim()) fail(`${label} must be a non-empty string`);
}

function requireStringArray(value, label) {
  if (!Array.isArray(value) || value.length === 0) fail(`${label} must contain at least one item`);
  value.forEach((item, index) => requireString(item, `${label}[${index}]`));
}

export function validateHarnessData(data) {
  requireObject(data, 'input');
  requireString(data.title, 'title');
  requireString(data.subtitle, 'subtitle');
  requireString(data.scope, 'scope');
  requireString(data.boundary, 'boundary');
  if (data.locale !== undefined && !['en', 'zh'].includes(data.locale)) {
    fail('locale must be en or zh');
  }

  if (!Array.isArray(data.metrics) || data.metrics.length === 0) fail('metrics must contain at least one item');
  data.metrics.forEach((metric, index) => {
    requireObject(metric, `metrics[${index}]`);
    requireString(metric.value, `metrics[${index}].value`);
    requireString(metric.label, `metrics[${index}].label`);
  });

  if (!Array.isArray(data.entryNodes) || data.entryNodes.length === 0) {
    fail('entryNodes must contain at least one item');
  }
  data.entryNodes.forEach((node, index) => {
    requireObject(node, `entryNodes[${index}]`);
    requireString(node.title, `entryNodes[${index}].title`);
    requireString(node.detail, `entryNodes[${index}].detail`);
  });

  if (!Array.isArray(data.evidenceLevels) || data.evidenceLevels.length === 0) {
    fail('evidenceLevels must contain at least one item');
  }
  data.evidenceLevels.forEach((level, index) => {
    requireObject(level, `evidenceLevels[${index}]`);
    requireString(level.title, `evidenceLevels[${index}].title`);
    requireString(level.detail, `evidenceLevels[${index}].detail`);
  });

  if (!Array.isArray(data.branches) || data.branches.length === 0) {
    fail('branches must contain at least one item');
  }
  const ids = new Set();
  data.branches.forEach((branch, index) => {
    const label = `branches[${index}]`;
    requireObject(branch, label);
    requireString(branch.id, `${label}.id`);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(branch.id)) {
      fail(`${label}.id must use lowercase hyphen-case`);
    }
    if (ids.has(branch.id)) fail(`${label}.id must be unique`);
    ids.add(branch.id);
    requireString(branch.label, `${label}.label`);
    requireStringArray(branch.intent, `${label}.intent`);
    requireStringArray(branch.sources, `${label}.sources`);
    requireStringArray(branch.reads, `${label}.reads`);
    requireStringArray(branch.evidence, `${label}.evidence`);
    if (!Number.isInteger(branch.level) || branch.level < 1 || branch.level > data.evidenceLevels.length) {
      fail(`${label}.level must be between 1 and ${data.evidenceLevels.length}`);
    }
  });

  return data;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function serializeForScript(value) {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');
}

export function renderHarnessGraph(rawData) {
  const data = validateHarnessData(rawData);
  const locale = data.locale === 'zh' ? 'zh' : 'en';
  const copy = locale === 'zh'
    ? {
        direct: '直接入口', progressive: '渐进阅读', evidence: '证据', select: '选择任务意图以展开阅读路径',
        empty: '选择一个分支，查看 Agent 会阅读什么以及获得哪些证据。', taskIntent: '任务意图',
        continueReading: '继续阅读', becomesKnown: '可获得的知识', concreteEvidence: '具体证据', boundary: '边界：',
      }
    : {
        direct: 'Direct entry', progressive: 'Progressive read', evidence: 'Evidence', select: 'Select a task intent to expand its reading path',
        empty: 'Select a branch to see what the agent reads and what evidence it obtains.', taskIntent: 'Task intent',
        continueReading: 'Continue reading', becomesKnown: 'What becomes known', concreteEvidence: 'Concrete evidence', boundary: 'Boundary:',
      };
  const metrics = data.metrics.map((metric) => `
      <div class="metric">
        <strong>${escapeHtml(metric.value)}</strong>
        <span>${escapeHtml(metric.label)}</span>
      </div>`).join('');
  const entries = data.entryNodes.map((entry, index) => `
      <div class="entry-node">
        <strong>${escapeHtml(entry.title)}</strong>
        <small>${escapeHtml(entry.detail)}</small>
      </div>${index === data.entryNodes.length - 1 ? '' : '<div class="edge-down" aria-hidden="true"></div>'}`).join('');
  const levels = data.evidenceLevels.map((level, index) => `
      <div class="evidence-step${index === 0 ? ' active' : ''}">
        <strong>${escapeHtml(level.title)}</strong>
        <span>${escapeHtml(level.detail)}</span>
      </div>`).join('');

  return `<!doctype html>
<html lang="${locale === 'zh' ? 'zh-CN' : 'en'}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(data.title)}</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: #f7f8fa;
      --surface: #ffffff;
      --direct: #eef4ff;
      --route: #edf8f1;
      --proof: #f5f1ff;
      --text: #1d2430;
      --muted: #647084;
      --border: #d7dce5;
      --line: #aeb7c5;
      --blue: #2563a8;
      --green: #217a4a;
      --purple: #6c4bb6;
      --danger: #a63d3d;
      --shadow: 0 6px 20px rgba(28, 39, 54, 0.08);
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #15181d;
        --surface: #1d2128;
        --direct: #18283d;
        --route: #172d22;
        --proof: #28213a;
        --text: #e8ebf0;
        --muted: #a7b0be;
        --border: #343b46;
        --line: #586273;
        --blue: #70a8e8;
        --green: #6fc794;
        --purple: #ae91eb;
        --danger: #ed8585;
        --shadow: 0 8px 24px rgba(0, 0, 0, 0.24);
      }
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-width: 320px;
      background: var(--bg);
      color: var(--text);
      font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      letter-spacing: 0;
    }
    main { width: min(1120px, calc(100% - 32px)); margin: 0 auto; padding: 28px 0 40px; }
    h1 { margin: 0; font-size: 24px; line-height: 1.3; font-weight: 600; }
    .subtitle { margin: 7px 0 18px; color: var(--muted); line-height: 1.55; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; overflow-wrap: anywhere; }
    .scope { color: var(--blue); font-weight: 600; }
    .snapshot {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 8px;
      margin-bottom: 22px;
    }
    .metric { padding: 10px 12px; border-bottom: 2px solid var(--border); }
    .metric strong { display: block; font-size: 20px; font-weight: 600; }
    .metric span { display: block; margin-top: 3px; color: var(--muted); font-size: 13px; }
    .legend { display: flex; flex-wrap: wrap; gap: 8px 18px; margin-bottom: 18px; color: var(--muted); font-size: 13px; }
    .legend span { display: inline-flex; align-items: center; gap: 7px; }
    .dot { width: 9px; height: 9px; border-radius: 50%; background: var(--blue); }
    .dot.route { background: var(--green); }
    .dot.proof { background: var(--purple); }
    .entry-flow { display: grid; justify-items: center; }
    .entry-node {
      width: min(520px, 100%);
      padding: 13px 16px;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: var(--direct);
      box-shadow: var(--shadow);
      text-align: center;
    }
    .entry-node strong { display: block; font-size: 15px; font-weight: 600; }
    .entry-node small { display: block; margin-top: 5px; color: var(--muted); font-size: 13px; line-height: 1.45; }
    .edge-down { width: 1px; height: 24px; background: var(--line); position: relative; }
    .edge-down::after {
      content: "";
      position: absolute;
      left: -3px;
      bottom: 0;
      width: 7px;
      height: 7px;
      border-right: 1px solid var(--line);
      border-bottom: 1px solid var(--line);
      transform: rotate(45deg);
    }
    .intent-label { margin: 24px 0 10px; font-size: 14px; font-weight: 600; text-align: center; }
    .intent-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 8px; }
    .intent-button {
      min-height: 58px;
      padding: 8px 7px;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: var(--surface);
      color: var(--text);
      font: inherit;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: border-color 150ms ease, background 150ms ease, transform 150ms ease;
    }
    .intent-button:hover { border-color: var(--green); background: var(--route); }
    .intent-button:focus-visible { outline: 3px solid color-mix(in srgb, var(--green) 35%, transparent); outline-offset: 2px; }
    .intent-button[aria-pressed="true"] { border-color: var(--green); background: var(--route); color: var(--green); transform: translateY(-2px); }
    .detail-region { margin-top: 18px; min-height: 290px; }
    .empty-state {
      display: grid;
      min-height: 240px;
      place-items: center;
      border-top: 1px dashed var(--border);
      border-bottom: 1px dashed var(--border);
      color: var(--muted);
      text-align: center;
    }
    .reading-path {
      display: grid;
      grid-template-columns: minmax(0, .68fr) 36px minmax(0, 1fr) 36px minmax(0, 1.32fr);
      align-items: stretch;
      animation: reveal 180ms ease-out;
    }
    @keyframes reveal { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
    @media (prefers-reduced-motion: reduce) { .reading-path { animation: none; } .intent-button { transition: none; } }
    .path-node { min-width: 0; padding: 15px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); }
    .path-node.route-node { background: var(--route); border-color: color-mix(in srgb, var(--green) 45%, var(--border)); }
    .path-node.proof-node { background: var(--proof); border-color: color-mix(in srgb, var(--purple) 45%, var(--border)); }
    .path-node h2 { margin: 0 0 10px; font-size: 15px; line-height: 1.35; font-weight: 600; }
    .path-node h3 { margin: 12px 0 5px; font-size: 13px; line-height: 1.35; font-weight: 600; }
    .path-node ul { margin: 0; padding-left: 18px; }
    .path-node li { margin: 5px 0; color: var(--muted); line-height: 1.45; }
    .path-arrow { display: grid; place-items: center; color: var(--line); font-size: 22px; }
    .evidence-footer {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
      gap: 8px;
      margin-top: 18px;
      padding-top: 14px;
      border-top: 1px solid var(--border);
    }
    .evidence-step { position: relative; padding: 18px 8px 8px; color: var(--muted); font-size: 13px; text-align: center; }
    .evidence-step::before {
      content: "";
      position: absolute;
      top: 3px;
      left: calc(50% - 5px);
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: var(--bg);
      border: 2px solid var(--line);
    }
    .evidence-step.active::before { border-color: var(--purple); background: var(--proof); }
    .evidence-step strong, .evidence-step span { display: block; }
    .evidence-step strong { color: var(--text); font-weight: 600; }
    .evidence-step span { margin-top: 2px; }
    .boundary {
      margin-top: 20px;
      padding: 12px 0 0 12px;
      border-top: 1px dashed var(--border);
      border-left: 3px solid var(--danger);
      color: var(--muted);
      line-height: 1.55;
    }
    .boundary strong { color: var(--text); }
    @media (max-width: 860px) {
      .reading-path { grid-template-columns: 1fr; gap: 8px; }
      .path-arrow { transform: rotate(90deg); min-height: 24px; }
    }
    @media (max-width: 560px) {
      main { width: min(100% - 20px, 1120px); padding-top: 18px; }
      h1 { font-size: 20px; }
    }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(data.title)}</h1>
    <p class="subtitle"><span class="scope">${escapeHtml(data.scope)}</span> · ${escapeHtml(data.subtitle)}</p>
    <div class="snapshot" aria-label="Harness snapshot">${metrics}
    </div>
    <div class="legend" aria-label="Node legend">
      <span><i class="dot" aria-hidden="true"></i>${copy.direct}</span>
      <span><i class="dot route" aria-hidden="true"></i>${copy.progressive}</span>
      <span><i class="dot proof" aria-hidden="true"></i>${copy.evidence}</span>
    </div>
    <section class="entry-flow" aria-label="Reading entries">${entries}
    </section>
    <div class="intent-label">${copy.select}</div>
    <div class="intent-grid" id="intent-grid" aria-label="Task intents"></div>
    <section class="detail-region" id="detail-region" aria-live="polite">
      <div class="empty-state">${copy.empty}</div>
    </section>
    <div class="evidence-footer" aria-label="Evidence levels">${levels}
    </div>
    <div class="boundary"><strong>${copy.boundary}</strong> ${escapeHtml(data.boundary)}</div>
  </main>
  <script>
    const branches = ${serializeForScript(data.branches)};
    const copy = ${serializeForScript(copy)};
    const intentGrid = document.getElementById('intent-grid');
    const detailRegion = document.getElementById('detail-region');
    const evidenceSteps = Array.from(document.querySelectorAll('.evidence-step'));
    let selectedId = null;

    function appendList(parent, items, useCode = false) {
      const list = document.createElement('ul');
      items.forEach((item) => {
        const row = document.createElement('li');
        if (useCode) {
          const code = document.createElement('code');
          code.textContent = item;
          row.appendChild(code);
        } else {
          row.textContent = item;
        }
        list.appendChild(row);
      });
      parent.appendChild(list);
    }

    function createPathNode(className, heading) {
      const node = document.createElement('section');
      node.className = className;
      const title = document.createElement('h2');
      title.textContent = heading;
      node.appendChild(title);
      return node;
    }

    function createArrow() {
      const arrow = document.createElement('div');
      arrow.className = 'path-arrow';
      arrow.setAttribute('aria-hidden', 'true');
      arrow.textContent = '→';
      return arrow;
    }

    function renderBranch(branch) {
      const path = document.createElement('div');
      path.className = 'reading-path';

      const intent = createPathNode('path-node', copy.taskIntent);
      appendList(intent, [branch.label, ...branch.intent]);

      const route = createPathNode('path-node route-node', copy.continueReading);
      appendList(route, branch.sources, true);
      const readsTitle = document.createElement('h3');
      readsTitle.textContent = copy.becomesKnown;
      route.appendChild(readsTitle);
      appendList(route, branch.reads);

      const proof = createPathNode('path-node proof-node', copy.concreteEvidence);
      appendList(proof, branch.evidence);

      path.append(intent, createArrow(), route, createArrow(), proof);
      detailRegion.replaceChildren(path);
      evidenceSteps.forEach((step, index) => step.classList.toggle('active', index < branch.level));
    }

    function selectBranch(id) {
      selectedId = selectedId === id ? null : id;
      document.querySelectorAll('.intent-button').forEach((button) => {
        button.setAttribute('aria-pressed', String(button.dataset.id === selectedId));
      });
      if (!selectedId) {
        const empty = document.createElement('div');
        empty.className = 'empty-state';
        empty.textContent = copy.empty;
        detailRegion.replaceChildren(empty);
        evidenceSteps.forEach((step, index) => step.classList.toggle('active', index === 0));
        return;
      }
      renderBranch(branches.find((branch) => branch.id === selectedId));
    }

    branches.forEach((branch) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'intent-button';
      button.dataset.id = branch.id;
      button.setAttribute('aria-pressed', 'false');
      button.textContent = branch.label;
      button.addEventListener('click', () => selectBranch(branch.id));
      intentGrid.appendChild(button);
    });
  </script>
</body>
</html>
`;
}

function renderGraphTabSet(graphs, locale, hidden = false) {
  if (!Array.isArray(graphs) || graphs.length === 0) throw new Error('graphs must contain at least one item');
  const labels = locale === 'zh'
    ? { title: 'Harness 阅读图', root: '仓库根目录', engine: 'Engine', canvas: 'Canvas Workspace', remote: 'Remote Server' }
    : { title: 'Harness Reading Graphs', root: 'Repository root', engine: 'Engine', canvas: 'Canvas Workspace', remote: 'Remote Server' };
  const labelByScope = {
    root: labels.root,
    'packages/engine': labels.engine,
    'apps/canvas-workspace': labels.canvas,
    'apps/remote-server': labels.remote,
  };
  const tabs = graphs.map((graph, index) => {
    const label = labelByScope[graph.scope] ?? graph.scope;
    return `<button class="tab" data-scope="${graph.scope}" type="button" role="tab" aria-selected="${index === 0}" aria-controls="${locale}-panel-${index}" id="${locale}-tab-${index}">${label}</button>`;
  }).join('');
  const panels = graphs.map((graph, index) => `
    <section class="panel" data-scope="${graph.scope}" id="${locale}-panel-${index}" role="tabpanel" aria-labelledby="${locale}-tab-${index}"${index === 0 ? '' : ' hidden'}>
      <iframe title="${escapeHtml(graph.title)}" srcdoc="${escapeHtml(renderHarnessGraph(graph))}"></iframe>
    </section>`).join('');
  return `<section class="locale-set" data-locale="${locale}"${hidden ? ' hidden' : ''}>
    <nav class="tabs" role="tablist" aria-label="${labels.title}">${tabs}</nav>${panels}
  </section>`;
}

function graphTabsDocument(body, locale, bilingual = false) {
  const language = locale === 'zh' ? 'zh-CN' : 'en';
  const title = locale === 'zh' ? 'Harness 阅读图' : 'Harness Reading Graphs';
  const languageSwitch = bilingual ? `<div class="language-switch" aria-label="Language">
    <button class="language-button" data-language="en" type="button" aria-pressed="${locale !== 'zh'}">English</button>
    <button class="language-button" data-language="zh" type="button" aria-pressed="${locale === 'zh'}">中文</button>
  </div>` : '';

  return `<!doctype html>
<html lang="${language}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>
    :root { color-scheme: light dark; --bg: #f7f8fa; --surface: #ffffff; --text: #1d2430; --border: #d7dce5; --active: #2563a8; }
    @media (prefers-color-scheme: dark) { :root { --bg: #15181d; --surface: #1d2128; --text: #e8ebf0; --border: #343b46; --active: #70a8e8; } }
    * { box-sizing: border-box; } body { margin: 0; background: var(--bg); color: var(--text); font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .language-switch { display: flex; justify-content: flex-end; gap: 6px; padding: 8px 16px 0; background: var(--surface); }
    .language-button { padding: 5px 9px; border: 1px solid var(--border); border-radius: 5px; background: transparent; color: var(--text); font: inherit; cursor: pointer; }
    .language-button[aria-pressed="true"] { border-color: var(--active); color: var(--active); font-weight: 600; }
    .tabs { display: flex; gap: 6px; padding: 12px 16px 0; border-bottom: 1px solid var(--border); background: var(--surface); }
    .tab { padding: 9px 13px; border: 1px solid transparent; border-bottom: 0; border-radius: 6px 6px 0 0; background: transparent; color: var(--text); font: inherit; cursor: pointer; }
    .tab[aria-selected="true"] { border-color: var(--border); background: var(--bg); color: var(--active); font-weight: 600; }
    .tab:focus-visible { outline: 3px solid color-mix(in srgb, var(--active) 35%, transparent); outline-offset: 2px; }
    .panel { height: calc(100vh - ${bilingual ? '96px' : '55px'}); } iframe { display: block; width: 100%; height: 100%; border: 0; }
  </style>
</head>
<body>
  ${languageSwitch}${body}
  <script>
    let selectedScope = 'root';
    function selectScope(locale, scope) {
      selectedScope = scope;
      const container = document.querySelector('.locale-set[data-locale="' + locale + '"]');
      container.querySelectorAll('.tab').forEach((tab) => tab.setAttribute('aria-selected', String(tab.dataset.scope === scope)));
      container.querySelectorAll('.panel').forEach((panel) => { panel.hidden = panel.dataset.scope !== scope; });
    }
    document.querySelectorAll('.locale-set').forEach((container) => {
      container.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => selectScope(container.dataset.locale, tab.dataset.scope)));
    });
    document.querySelectorAll('.language-button').forEach((button) => button.addEventListener('click', () => {
      const locale = button.dataset.language;
      document.querySelectorAll('.locale-set').forEach((container) => { container.hidden = container.dataset.locale !== locale; });
      document.querySelectorAll('.language-button').forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
      selectScope(locale, selectedScope);
    }));
  </script>
</body>
</html>`;
}

export function renderHarnessGraphTabs(graphs, locale = 'en') {
  return graphTabsDocument(renderGraphTabSet(graphs, locale), locale);
}

export function renderBilingualHarnessGraphTabs(graphsByLocale, initialLocale = 'en') {
  const locale = initialLocale === 'zh' ? 'zh' : 'en';
  if (!graphsByLocale || !graphsByLocale.en || !graphsByLocale.zh) {
    throw new Error('graphsByLocale must include en and zh graphs');
  }
  return graphTabsDocument(
    `${renderGraphTabSet(graphsByLocale.en, 'en', locale !== 'en')}${renderGraphTabSet(graphsByLocale.zh, 'zh', locale !== 'zh')}`,
    locale,
    true,
  );
}

function parseArgs(argv) {
  const args = { input: null, output: null, scope: null, locale: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--input') args.input = argv[++index];
    else if (arg === '--output') args.output = argv[++index];
    else if (arg === '--scope') args.scope = argv[++index];
    else if (arg === '--locale') args.locale = argv[++index];
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: render-harness-graph.mjs (--input <graph.json> | --scope <root|engine|canvas-workspace|all>) --output <graph.html> [--locale <en|zh>]');
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if ((!args.input && !args.scope) || (args.input && args.scope)) {
    throw new Error('provide exactly one of --input or --scope');
  }
  if (!args.output) throw new Error('--output is required');
  if (args.locale && !['en', 'zh'].includes(args.locale)) throw new Error('--locale must be en or zh');
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const input = args.scope
    ? (args.scope === 'all'
      ? { en: createAllScopeGraphs('en'), zh: createAllScopeGraphs('zh') }
      : createScopeGraph(args.scope, args.locale || 'en'))
    : { ...JSON.parse(fs.readFileSync(path.resolve(args.input), 'utf8')), ...(args.locale ? { locale: args.locale } : {}) };
  const output = path.resolve(args.output);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, args.scope === 'all'
    ? renderBilingualHarnessGraphTabs(input, args.locale || 'en')
    : renderHarnessGraph(input));
  console.log(output);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
