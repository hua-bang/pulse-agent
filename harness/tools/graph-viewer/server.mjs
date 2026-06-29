#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

function readText(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function exists(relativePath) {
  return fs.existsSync(path.join(repoRoot, relativePath));
}

function listFiles(relativeDir, predicate) {
  const dir = path.join(repoRoot, relativeDir);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(relativeDir, entry.name))
    .filter(predicate ?? (() => true));
}

function listDirs(relativeDir) {
  const dir = path.join(repoRoot, relativeDir);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(relativeDir, entry.name));
}

function parseScalar(value) {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return trimmed;
}

function parseSimpleYaml(text) {
  const root = {};
  const stack = [{ indent: -1, value: root }];
  const lines = text.split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    if (!raw.trim() || raw.trimStart().startsWith('#')) continue;
    const indent = raw.match(/^\s*/)[0].length;
    const line = raw.trim();

    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1].value;

    if (line.startsWith('- ')) {
      if (!Array.isArray(parent)) continue;
      const itemText = line.slice(2).trim();
      if (!itemText) {
        const obj = {};
        parent.push(obj);
        stack.push({ indent, value: obj });
      } else if (itemText.includes(': ')) {
        const [key, ...rest] = itemText.split(':');
        const obj = { [key.trim()]: parseScalar(rest.join(':')) };
        parent.push(obj);
        stack.push({ indent, value: obj });
      } else {
        parent.push(parseScalar(itemText));
      }
      continue;
    }

    const match = line.match(/^([^:]+):(.*)$/);
    if (!match) continue;
    const key = match[1].trim();
    const rest = match[2].trim();

    if (rest) {
      parent[key] = parseScalar(rest);
      continue;
    }

    const next = lines.slice(i + 1).find((candidate) => candidate.trim() && !candidate.trimStart().startsWith('#'));
    const nextTrim = next?.trim() ?? '';
    const container = nextTrim.startsWith('- ') ? [] : {};
    parent[key] = container;
    stack.push({ indent, value: container });
  }

  return root;
}

function parseFrontmatter(text) {
  if (!text.startsWith('---')) return {};
  const end = text.indexOf('\n---', 3);
  if (end === -1) return {};
  return parseSimpleYaml(text.slice(3, end));
}

function titleFromMarkdown(text) {
  return text.split(/\r?\n/).find((line) => line.startsWith('# '))?.replace(/^#\s+/, '').trim();
}

function extractPathRefs(text) {
  const refs = new Set();
  const patterns = [
    /`((?:\.\.\/|\.\/|[\w.-]+\/)[^`\n]+?)`/g,
    /\[[^\]]+\]\(([^)]+)\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const value = match[1].replace(/^\.\//, '').split('#')[0];
      if (/^(https?:|mailto:)/.test(value)) continue;
      if (value.includes(' ') && !value.includes('/')) continue;
      refs.add(value);
    }
  }
  return [...refs];
}

function nodeId(type, id) {
  return `${type}:${id}`;
}

function buildGraph() {
  const nodes = new Map();
  const edges = [];

  function addNode(id, type, label, meta = {}) {
    if (!nodes.has(id)) nodes.set(id, { id, type, label, meta });
    return nodes.get(id);
  }

  function addEdge(from, to, type, confidence = 'high', meta = {}) {
    if (!nodes.has(from) || !nodes.has(to)) return;
    edges.push({ from, to, type, confidence, meta });
  }

  addNode(nodeId('root', 'AGENTS.md'), 'root', 'AGENTS.md', { path: 'AGENTS.md' });
  addNode(nodeId('root', 'CLAUDE.md'), 'root', 'CLAUDE.md', { path: 'CLAUDE.md' });
  addNode(nodeId('harness', 'README.md'), 'harness', 'harness/README.md', { path: 'harness/README.md' });
  addNode(nodeId('harness', 'profile.yaml'), 'profile', 'profile.yaml', { path: 'harness/profile.yaml' });
  addNode(nodeId('harness', 'validation.yaml'), 'validation', 'validation.yaml', { path: 'harness/validation.yaml' });
  addEdge(nodeId('root', 'AGENTS.md'), nodeId('harness', 'README.md'), 'routes_to');
  addEdge(nodeId('root', 'CLAUDE.md'), nodeId('harness', 'README.md'), 'routes_to');
  addEdge(nodeId('harness', 'README.md'), nodeId('harness', 'profile.yaml'), 'routes_to');
  addEdge(nodeId('harness', 'README.md'), nodeId('harness', 'validation.yaml'), 'routes_to');

  const profile = parseSimpleYaml(readText('harness/profile.yaml'));
  const validation = parseSimpleYaml(readText('harness/validation.yaml'));

  for (const [workspacePath, workspace] of Object.entries(profile.workspaces ?? {})) {
    const wid = nodeId('workspace', workspacePath);
    addNode(wid, 'workspace', workspacePath, { path: workspacePath, ...workspace });
    addEdge(nodeId('harness', 'profile.yaml'), wid, 'maps_workspace');

    if (workspace.entry) {
      const eid = nodeId('entry', workspace.entry);
      addNode(eid, exists(workspace.entry) ? 'entry' : 'gap', path.basename(workspace.entry), { path: workspace.entry, exists: exists(workspace.entry) });
      addEdge(wid, eid, exists(workspace.entry) ? 'has_entry' : 'missing', exists(workspace.entry) ? 'high' : 'high');
    }

    for (const [kind, target] of Object.entries(workspace.knowledge ?? {})) {
      if (typeof target !== 'string') continue;
      const kid = nodeId('knowledge', target);
      addNode(kid, exists(target) ? 'knowledge' : 'gap', `${kind}: ${path.basename(target)}`, { path: target, kind, exists: exists(target) });
      addEdge(wid, kid, exists(target) ? 'has_knowledge' : 'missing', exists(target) ? 'high' : 'high', { kind });
    }
  }

  for (const rule of validation.pathRules ?? []) {
    if (!rule?.name) continue;
    const rid = nodeId('validation-rule', rule.name);
    addNode(rid, 'validation', rule.name, { paths: rule.paths ?? [], required: rule.required ?? [] });
    addEdge(nodeId('harness', 'validation.yaml'), rid, 'defines_validation');
    const workspace = Object.keys(profile.workspaces ?? {}).find((candidate) => (rule.paths ?? []).some((p) => p.startsWith(candidate)));
    if (workspace) addEdge(rid, nodeId('workspace', workspace), 'validates');
  }

  for (const file of listFiles('harness/skills', (f) => f.endsWith('.md') && !f.endsWith('/README.md'))) {
    const text = readText(file);
    const fm = parseFrontmatter(text);
    const sid = nodeId('skill', file);
    addNode(sid, 'skill', fm.name ?? titleFromMarkdown(text) ?? path.basename(file), { path: file, description: fm.description ?? '' });
    addEdge(nodeId('harness', 'README.md'), sid, 'defines_action');
  }

  for (const dir of listDirs('harness/tools')) {
    const readme = path.join(dir, 'README.md');
    if (readme.endsWith('graph-viewer/README.md')) continue;
    if (!exists(readme)) continue;
    const text = readText(readme);
    const tid = nodeId('tool', dir);
    addNode(tid, 'tool', path.basename(dir), { path: readme, title: titleFromMarkdown(text) ?? path.basename(dir) });
    addEdge(nodeId('harness', 'README.md'), tid, 'defines_tool');
  }

  const markdownFiles = [
    'harness/README.md',
    ...listFiles('harness/skills', (f) => f.endsWith('.md')),
    ...listDirs('harness/tools').map((dir) => path.join(dir, 'README.md')).filter(exists),
  ];

  const knownPaths = new Map();
  for (const node of nodes.values()) {
    if (node.meta?.path) knownPaths.set(node.meta.path, node.id);
  }

  for (const file of markdownFiles) {
    const from = knownPaths.get(file) ?? [...nodes.values()].find((node) => node.meta?.path === file)?.id;
    if (!from) continue;
    for (const ref of extractPathRefs(readText(file))) {
      const normalized = path.normalize(path.join(path.dirname(file), ref)).replaceAll('\\', '/');
      const direct = knownPaths.get(ref) ?? knownPaths.get(normalized);
      if (direct) addEdge(from, direct, 'references', 'medium', { ref });
    }
  }

  const nodeList = [...nodes.values()];
  const gapCount = nodeList.filter((node) => node.type === 'gap').length;
  return {
    generatedAt: new Date().toISOString(),
    summary: {
      nodes: nodeList.length,
      edges: edges.length,
      workspaces: nodeList.filter((node) => node.type === 'workspace').length,
      skills: nodeList.filter((node) => node.type === 'skill').length,
      tools: nodeList.filter((node) => node.type === 'tool').length,
      gaps: gapCount,
    },
    nodes: nodeList,
    edges,
  };
}

function html(graph) {
  const graphJson = JSON.stringify(graph).replaceAll('<', '\\u003c');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Harness Map</title>
<style>
:root { color-scheme: dark; --bg:#10120f; --panel:#181c15; --panel2:#20251b; --line:#35402f; --text:#eef6df; --muted:#a9b69a; --accent:#d7ff5f; --blue:#7cc7ff; --green:#79e08e; --yellow:#f3d36b; --purple:#c796ff; --red:#ff6d61; }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--text); font:14px/1.45 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
.app { min-height:100vh; display:grid; grid-template-columns: 380px 1fr 340px; }
aside, main { border-right:1px solid var(--line); }
aside { padding:18px; overflow:auto; background:var(--panel); }
main { padding:18px; overflow:auto; background:radial-gradient(circle at 15% 5%, #26311d 0 12%, transparent 30%), #11140f; }
h1 { margin:0 0 4px; font-size:26px; letter-spacing:.02em; }
h2 { margin:18px 0 10px; color:var(--accent); font-size:15px; }
.sub { color:var(--muted); margin-bottom:16px; }
.stats { display:grid; grid-template-columns: repeat(2, 1fr); gap:8px; }
.stat { background:var(--panel2); border:1px solid var(--line); padding:10px; }
.stat b { display:block; color:var(--accent); font-size:20px; }
.row { display:grid; grid-template-columns: 1fr auto; gap:10px; align-items:center; padding:9px; border:1px solid var(--line); background:#141812; margin-bottom:7px; cursor:pointer; }
.row:hover, .row.active { border-color:var(--accent); }
.row small { color:var(--muted); display:block; margin-top:3px; }
.badges { display:flex; gap:5px; flex-wrap:wrap; justify-content:flex-end; }
.badge { border:1px solid var(--line); padding:2px 5px; color:var(--muted); font-size:11px; }
.badge.ok { color:var(--green); border-color:#406b48; }
.badge.warn { color:var(--red); border-color:#7a4039; }
.flow { display:grid; gap:12px; max-width:920px; }
.step { border:1px solid var(--line); background:rgba(24,28,21,.86); padding:14px; position:relative; }
.step:not(:last-child)::after { content:'↓'; position:absolute; left:20px; bottom:-22px; color:var(--accent); font-size:20px; }
.step-title { color:var(--accent); font-weight:700; margin-bottom:4px; }
.cards { display:grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap:10px; margin-top:12px; }
.card { border:1px solid var(--line); background:var(--panel2); padding:12px; }
.card strong { color:var(--yellow); }
.graph-box { height:380px; margin-top:16px; border:1px solid var(--line); background:#0d100c; position:relative; overflow:hidden; }
svg { width:100%; height:100%; display:block; }
.edge { stroke:#59614f; stroke-width:1.1; opacity:.45; }
.edge.high { stroke:var(--accent); opacity:.65; }
.node circle { stroke:#0a0c09; stroke-width:2; }
.node text { fill:var(--text); font-size:10px; paint-order:stroke; stroke:#0d100c; stroke-width:4px; }
pre { white-space:pre-wrap; word-break:break-word; background:#0d100c; border:1px solid var(--line); padding:10px; color:#dce8cf; }
.kv { color:var(--muted); }
button { border:1px solid var(--line); background:#141812; color:var(--text); padding:7px 9px; font:inherit; cursor:pointer; }
button.active { color:var(--accent); border-color:var(--accent); }
</style>
</head>
<body>
<div class="app">
  <aside>
    <h1>Harness Map</h1>
    <div class="sub">Readable view of repository harness coverage and routing.</div>
    <div class="stats" id="stats"></div>
    <h2>Workspaces</h2>
    <div id="workspace-list"></div>
  </aside>
  <main>
    <h2>Main Loop</h2>
    <section class="flow">
      <div class="step"><div class="step-title">1. Route</div><div>Root entries route to <code>harness/profile.yaml</code>, then to the affected workspace entry.</div></div>
      <div class="step"><div class="step-title">2. Read Knowledge</div><div>Workspace entries point to README, contracts, runbook, validation, or product docs as needed.</div></div>
      <div class="step"><div class="step-title">3. Act</div><div>Common action protocols live in <code>harness/skills</code>; reusable atomic capabilities live in <code>harness/tools</code>.</div></div>
      <div class="step"><div class="step-title">4. Validate</div><div><code>harness/validation.yaml</code> maps paths to validation rules and escalation points.</div></div>
      <div class="step"><div class="step-title">5. Feed Back</div><div>Feedback starts in <code>harness/feedback</code>, then accepted facts move to the right long-term target.</div></div>
    </section>
    <h2>Action Surface</h2>
    <div class="cards" id="surface"></div>
    <h2>Graph Preview</h2>
    <div><button id="toggle-graph">Pause graph</button></div>
    <div class="graph-box"><svg id="graph" role="img" aria-label="Harness graph preview"></svg></div>
  </main>
  <aside>
    <h2 id="detail-title">Select a workspace</h2>
    <div id="detail-body" class="kv">Click a workspace on the left or a node in the graph.</div>
    <h2>Connected Edges</h2>
    <pre id="edge-list">No selection</pre>
  </aside>
</div>
<script>
const graph = ${graphJson};
const colors = { root:'#d7ff5f', harness:'#ffad57', profile:'#ffad57', validation:'#ff7ab6', workspace:'#7cc7ff', entry:'#79e08e', knowledge:'#b5d98d', skill:'#f3d36b', tool:'#c796ff', gap:'#ff6d61' };
const nodes = graph.nodes.map((n, i) => ({...n, x: 420 + Math.cos(i)*160, y: 190 + Math.sin(i)*130, vx:0, vy:0}));
const byId = new Map(nodes.map(n => [n.id, n]));
const edges = graph.edges.map(e => ({...e, source: byId.get(e.from), target: byId.get(e.to)})).filter(e => e.source && e.target);
const svg = document.getElementById('graph');
let running = true;

function escapeHtml(s){ return String(s).replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }
function radius(n){ return n.type==='workspace'?10:n.type==='gap'?9:6; }
function workspaceStatus(w){
  const outgoing = graph.edges.filter(e => e.from === w.id);
  const hasEntry = outgoing.some(e => e.type === 'has_entry');
  const hasValidation = outgoing.some(e => e.meta?.kind === 'validation');
  const hasContract = outgoing.some(e => e.meta?.kind === 'contracts' || e.meta?.kind === 'runbook');
  return { hasEntry, hasValidation, hasContract };
}
function init(){
  document.getElementById('stats').innerHTML = [['Workspaces',graph.summary.workspaces],['Skills',graph.summary.skills],['Tools',graph.summary.tools],['Gaps',graph.summary.gaps]].map(([k,v]) => '<div class="stat"><b>'+v+'</b>'+k+'</div>').join('');
  const workspaces = graph.nodes.filter(n => n.type === 'workspace');
  document.getElementById('workspace-list').innerHTML = workspaces.map(w => {
    const s = workspaceStatus(w);
    return '<div class="row" data-id="'+w.id+'"><div>'+escapeHtml(w.label)+'<small>'+escapeHtml(w.meta.role || '')+'</small></div><div class="badges">'+
      '<span class="badge '+(s.hasEntry?'ok':'warn')+'">entry</span>'+
      '<span class="badge '+(s.hasValidation?'ok':'')+'">validation</span>'+
      '<span class="badge '+(s.hasContract?'ok':'')+'">contract/runbook</span>'+
    '</div></div>';
  }).join('');
  document.getElementById('workspace-list').addEventListener('click', e => {
    const row = e.target.closest('.row'); if(!row) return;
    selectNode(row.dataset.id);
    document.querySelectorAll('.row').forEach(r => r.classList.toggle('active', r === row));
  });
  document.getElementById('surface').innerHTML = [
    ['Skills', graph.nodes.filter(n=>n.type==='skill').map(n=>n.label)],
    ['Tools', graph.nodes.filter(n=>n.type==='tool').map(n=>n.label)],
    ['Validation rules', graph.nodes.filter(n=>n.type==='validation').map(n=>n.label)]
  ].map(([title, items]) => '<div class="card"><strong>'+title+'</strong><br>'+items.map(escapeHtml).join('<br>')+'</div>').join('');
  document.getElementById('toggle-graph').onclick = () => { running = !running; document.getElementById('toggle-graph').textContent = running ? 'Pause graph' : 'Resume graph'; };
}
function selectNode(id){
  const n = byId.get(id) || graph.nodes.find(x => x.id === id); if(!n) return;
  document.getElementById('detail-title').textContent = n.label;
  document.getElementById('detail-body').innerHTML = '<pre>'+escapeHtml(JSON.stringify(n.meta, null, 2))+'</pre>';
  const related = graph.edges.filter(e => e.from===n.id || e.to===n.id).map(e => e.type+' '+e.confidence+'\\n  '+e.from+'\\n  -> '+e.to).join('\\n\\n');
  document.getElementById('edge-list').textContent = related || 'No connected edges';
}
function tick(){
  if(running){
    const width = svg.clientWidth || 800, height = svg.clientHeight || 360;
    for(const n of nodes){ n.vx += (width/2 - n.x)*0.0007; n.vy += (height/2 - n.y)*0.0007; }
    for(let i=0;i<nodes.length;i++) for(let j=i+1;j<nodes.length;j++){
      const a=nodes[i], b=nodes[j]; let dx=a.x-b.x, dy=a.y-b.y, d=Math.max(24, Math.hypot(dx,dy)); const f=1200/(d*d); a.vx+=dx/d*f; a.vy+=dy/d*f; b.vx-=dx/d*f; b.vy-=dy/d*f;
    }
    for(const e of edges){ const a=e.source,b=e.target; let dx=b.x-a.x, dy=b.y-a.y, d=Math.max(1, Math.hypot(dx,dy)); const f=(d-120)*0.005; a.vx+=dx/d*f; a.vy+=dy/d*f; b.vx-=dx/d*f; b.vy-=dy/d*f; }
    for(const n of nodes){ n.vx*=.82; n.vy*=.82; n.x=Math.max(20,Math.min(width-20,n.x+n.vx)); n.y=Math.max(20,Math.min(height-20,n.y+n.vy)); }
  }
  render(); requestAnimationFrame(tick);
}
function render(){
  while(svg.firstChild) svg.removeChild(svg.firstChild);
  const frag = document.createDocumentFragment();
  for(const e of edges){
    const line = document.createElementNS('http://www.w3.org/2000/svg','line'); line.setAttribute('class','edge '+e.confidence); line.setAttribute('x1',e.source.x); line.setAttribute('y1',e.source.y); line.setAttribute('x2',e.target.x); line.setAttribute('y2',e.target.y); frag.appendChild(line);
  }
  for(const n of nodes){
    const g = document.createElementNS('http://www.w3.org/2000/svg','g'); g.setAttribute('class','node'); g.dataset.id=n.id; g.setAttribute('transform','translate('+n.x+','+n.y+')');
    const c = document.createElementNS('http://www.w3.org/2000/svg','circle'); c.setAttribute('r',radius(n)); c.setAttribute('fill',colors[n.type]||'#ddd');
    const t = document.createElementNS('http://www.w3.org/2000/svg','text'); t.setAttribute('x',radius(n)+5); t.setAttribute('y',4); t.textContent=n.label;
    g.appendChild(c); g.appendChild(t); frag.appendChild(g);
  }
  svg.appendChild(frag);
}
svg.addEventListener('click', e => { const g=e.target.closest('.node'); if(g) selectNode(g.dataset.id); });
init(); tick();
</script>
</body>
</html>`;
}


function printSummary(graph) {
  console.log(JSON.stringify(graph.summary, null, 2));
  const gaps = graph.nodes.filter((node) => node.type === 'gap');
  if (gaps.length) {
    console.log('\nGaps:');
    for (const gap of gaps) console.log(`- ${gap.meta?.path ?? gap.id}`);
  }
}

const graph = buildGraph();
if (process.argv.includes('--once')) {
  printSummary(graph);
  process.exit(0);
}

const portArg = process.argv.find((arg) => arg.startsWith('--port='));
const preferredPort = portArg ? Number(portArg.split('=')[1]) : 4177;
const server = http.createServer((req, res) => {
  if (req.url === '/graph.json') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(graph, null, 2));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html(graph));
});
server.listen(preferredPort, '127.0.0.1', () => {
  console.log(`Harness graph viewer: http://127.0.0.1:${preferredPort}`);
});
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      console.log(`Harness graph viewer: http://127.0.0.1:${address.port}`);
    });
    return;
  }
  throw error;
});
