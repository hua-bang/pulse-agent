/**
 * Rsdoctor-inspired HTML report for bundle analysis.
 *
 * The Vite/Rollup ecosystem has no standardized Rsdoctor-equivalent, so this
 * page fills the gap: tabs (Overview / Chunks / Modules / Duplicates), sortable
 * tables, search, and an entry/async distinction — all derived client-side
 * from a single flat chunks array (built by bundle-treemap.mjs from Vite's
 * official manifest + rollup-plugin-visualizer's module tree).
 *
 * Data shape (view):
 *   { totalKb, entryKb, asyncKb, chunks: [{ name, kb, isEntry, feature,
 *     moduleCount, leaves: [{ path, kb }] }] }
 */

export const renderBundleSplitHtml = (view) => {
  const dataJson = JSON.stringify(view);
  return `<!DOCTYPE html>
<html lang="zh"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Bundle Analysis — Entry vs Async</title>
<style>
  :root { --bg:#16171f; --bg2:#1e2030; --bg3:#272a3f; --fg:#c0caf5; --muted:#5b6394; --border:#2f334d; --entry:#e03131; --async:#1c7ed6; --mod:#9ece6a; --dup:#fab005; }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--fg);font:13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
  header{position:sticky;top:0;z-index:10;background:var(--bg2);border-bottom:1px solid var(--border);padding:14px 24px;display:flex;flex-direction:column;gap:10px}
  .hd-top{display:flex;align-items:baseline;gap:16px;flex-wrap:wrap}
  h1{margin:0;font-size:18px}
  .metrics{color:var(--muted);font-size:12px}
  .metrics b{color:var(--fg)}
  .hd-controls{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
  .tabs{display:flex;gap:2px}
  .tab{background:transparent;border:1px solid transparent;color:var(--muted);padding:5px 14px;border-radius:6px;cursor:pointer;font-size:13px;font-weight:500}
  .tab:hover{color:var(--fg);background:var(--bg3)}
  .tab.active{background:var(--bg3);color:var(--fg);border-color:var(--border)}
  .tab .cnt{font-size:10px;color:var(--muted);margin-left:4px}
  .search{flex:1;min-width:180px;background:var(--bg);border:1px solid var(--border);color:var(--fg);padding:6px 10px;border-radius:6px;font-size:13px}
  .search:focus{outline:none;border-color:var(--async)}
  main{padding:20px 24px;max-width:1400px;margin:0 auto}
  .panel{display:none}
  .panel.active{display:block}
  .card{background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:16px;margin-bottom:14px}
  .card.entry{border-left:3px solid var(--entry)}
  .card.async{border-left:3px solid var(--async)}
  h2{margin:0 0 4px;font-size:15px}
  h3{margin:14px 0 8px;font-size:13px;color:var(--muted);font-weight:600}
  .sub{color:var(--muted);font-size:12px;margin:0 0 12px}
  .badge{display:inline-block;font-size:10px;font-weight:700;padding:2px 7px;border-radius:3px;letter-spacing:.4px;vertical-align:middle}
  .b-entry{background:var(--entry);color:#fff}
  .b-async{background:var(--async);color:#fff}
  table{width:100%;border-collapse:collapse;font-size:12px}
  th{color:var(--muted);font-weight:600;text-align:left;padding:8px 10px;border-bottom:1px solid var(--border);cursor:pointer;user-select:none;white-space:nowrap}
  th:hover{color:var(--fg)}
  th.sort::after{content:" ▾";color:var(--async)}
  th.sort.asc::after{content:" ▴"}
  td{padding:7px 10px;border-bottom:1px solid var(--border);vertical-align:middle}
  tr:hover td{background:var(--bg3)}
  .cname{font-family:ui-monospace,Menlo,monospace;color:#bb9af7;cursor:pointer}
  .cname:hover{text-decoration:underline}
  .mname{font-family:ui-monospace,Menlo,monospace;color:#bb9af7;word-break:break-all}
  .num{text-align:right;font-family:ui-monospace,monospace;color:#9ece6a;white-space:nowrap}
  .bar{display:inline-block;width:100%;max-width:120px;height:6px;background:var(--bg3);border-radius:3px;overflow:hidden;vertical-align:middle}
  .bar-fill{display:block;height:100%;border-radius:3px}
  .ftype{color:var(--muted);font-size:11px}
  .empty{color:var(--muted);padding:24px;text-align:center}
  .hint{color:var(--muted);font-size:11px;margin-top:8px}
</style></head><body>
<header>
  <div class="hd-top">
    <h1>Bundle Analysis</h1>
    <div class="metrics" id="metrics"></div>
  </div>
  <div class="hd-controls">
    <div class="tabs" id="tabs">
      <button class="tab active" data-tab="overview">Overview</button>
      <button class="tab" data-tab="chunks">Chunks<span class="cnt" id="cnt-chunks"></span></button>
      <button class="tab" data-tab="modules">Modules<span class="cnt" id="cnt-mods"></span></button>
      <button class="tab" data-tab="duplicates">Duplicates<span class="cnt" id="cnt-dups"></span></button>
    </div>
    <input class="search" id="search" placeholder="filter by chunk / module name…">
  </div>
</header>
<main>
  <section id="overview" class="panel active"></section>
  <section id="chunks" class="panel"></section>
  <section id="modules" class="panel"></section>
  <section id="duplicates" class="panel"></section>
</main>
<script type="application/json" id="d">${dataJson}</script>
<script>
const view = JSON.parse(document.getElementById('d').textContent);
const chunks = view.chunks;
const modules = chunks.flatMap(c => c.leaves.map(l => ({path: l.path, kb: l.kb, chunk: c.name, isEntry: c.isEntry, feature: c.feature})));
const byPath = new Map();
for (const m of modules) { if (!byPath.has(m.path)) byPath.set(m.path, []); byPath.get(m.path).push(m); }
const duplicates = [...byPath.values()].filter(a => a.length > 1).map(a => ({path: a[0].path, chunks: a.map(m=>m.chunk), totalKb: a.reduce((s,m)=>s+m.kb,0), count: a.length})).sort((a,b)=>b.totalKb-a.totalKb);
const maxChunkKb = chunks.length ? chunks[0].kb : 1;
const maxModKb = modules.length ? Math.max(...modules.map(m=>m.kb)) : 1;
const fmt = kb => kb.toLocaleString() + ' KB';
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const shortPath = p => p.split('/').slice(-3).join('/').replace(/^assets\\/[^/]+\\//,'');
const bar = (kb, max, color) => '<span class="bar"><span class="bar-fill" style="width:'+Math.max(1,(kb/max*100)).toFixed(1)+'%;background:'+color+'"></span></span>';
const typeBadge = isEntry => isEntry ? '<span class="badge b-entry">✱ ENTRY</span>' : '<span class="badge b-async">ASYNC</span>';

document.getElementById('metrics').innerHTML = '合计 <b>'+fmt(view.totalKb)+'</b> · ✱ Entry <b>'+fmt(view.entryKb)+' ('+((view.entryKb/view.totalKb)*100).toFixed(0)+'%)</b> · Async <b>'+fmt(view.asyncKb)+' ('+((view.asyncKb/view.totalKb)*100).toFixed(0)+'%)</b>';
document.getElementById('cnt-chunks').textContent = chunks.length;
document.getElementById('cnt-mods').textContent = modules.length;
document.getElementById('cnt-dups').textContent = duplicates.length;

let activeTab = 'overview';
let sortState = {chunks:{key:'kb',dir:-1}, modules:{key:'kb',dir:-1}, dups:{key:'totalKb',dir:-1}};
let searchTerm = '';

function renderOverview() {
  const entry = chunks.find(c => c.isEntry);
  const asyncChunks = chunks.filter(c => !c.isEntry);
  const groups = new Map();
  for (const c of asyncChunks) { if (!groups.has(c.feature)) groups.set(c.feature, {kb:0,n:0,items:[]}); const g=groups.get(c.feature); g.kb+=c.kb; g.n+=1; g.items.push(c); }
  const sortedGroups = [...groups.values()].sort((a,b)=>b.kb-a.kb);
  let h = '<div class="card entry"><h2><span class="badge b-entry">✱ ENTRY</span> 启动时全量 parse — 每次启动都付成本</h2>';
  h += '<p class="sub">'+(entry?esc(entry.name):'未找到入口')+' · '+fmt(view.entryKb)+' · '+(view.totalKb?((view.entryKb/view.totalKb)*100).toFixed(0):0)+'% of total</p>';
  if (entry) { h += '<table><tbody>'; const top = entry.leaves.slice(0,8); for (const l of top) h += '<tr><td class="mname">'+esc(shortPath(l.path))+'</td><td class="num">'+fmt(l.kb)+'</td><td>'+bar(l.kb, maxModKb, '#e03131')+'</td></tr>'; h += '</tbody></table>'; if (entry.leaves.length>8) h += '<div class="hint">另 '+entry.moduleCount+' 个模块,见 Modules tab</div>'; }
  h += '</div>';
  h += '<div class="card async"><h2><span class="badge b-async">ASYNC</span> 按需 lazy — 用到对应功能才加载</h2><p class="sub">'+asyncChunks.length+' chunks · '+fmt(view.asyncKb)+'</p>';
  for (const g of sortedGroups) { h += '<h3>'+esc(g.feature)+' <span class="ftype">'+fmt(g.kb)+' · '+g.n+' chunks</span></h3><table><tbody>'; for (const c of g.items.slice(0,6)) h += '<tr><td class="cname" data-chunk="'+esc(c.name)+'">'+esc(c.name)+'</td><td class="num">'+fmt(c.kb)+'</td><td>'+bar(c.kb, maxChunkKb, '#1c7ed6')+'</td></tr>'; h += '</tbody></table>'; if (g.items.length>6) h += '<div class="hint">另 '+(g.items.length-6)+' 个,见 Chunks tab</div>'; }
  h += '</div>';
  return h;
}

function table(headers, rows) {
  let h = '<table><thead><tr>';
  for (const hd of headers) h += '<th data-key="'+hd.key+'"'+(hd.sort?' class="sort'+(hd.sort>0?' asc':'')+'"':'')+'>'+hd.label+'</th>';
  h += '</tr></thead><tbody>'+rows+'</tbody></table>';
  return h;
}

function renderChunks() {
  const st = sortState.chunks;
  let rows = chunks.filter(c => !searchTerm || c.name.toLowerCase().includes(searchTerm) || c.feature.toLowerCase().includes(searchTerm));
  rows = rows.slice().sort((a,b) => { let va=a[st.key], vb=b[st.key]; if (typeof va==='string') return va.localeCompare(vb)*st.dir; return (va-vb)*st.dir; });
  if (!rows.length) return '<div class="empty">无匹配 chunk</div>';
  let body = '';
  for (const c of rows) body += '<tr><td class="cname" data-chunk="'+esc(c.name)+'">'+esc(c.name)+'</td><td>'+typeBadge(c.isEntry)+'</td><td class="ftype">'+esc(c.feature)+'</td><td class="num">'+fmt(c.kb)+'</td><td>'+bar(c.kb, maxChunkKb, c.isEntry?'#e03131':'#1c7ed6')+'</td><td class="num">'+c.moduleCount+'</td></tr>';
  return table([{key:'name',label:'chunk',sort:st.key==='name'?st.dir:0},{key:'isEntry',label:'type',sort:st.key==='isEntry'?st.dir:0},{key:'feature',label:'feature',sort:st.key==='feature'?st.dir:0},{key:'kb',label:'size',sort:st.key==='kb'?st.dir:0},{key:'_bar',label:''},{key:'moduleCount',label:'modules',sort:st.key==='moduleCount'?st.dir:0}], body);
}

function renderModules() {
  const st = sortState.modules;
  let rows = modules.filter(m => !searchTerm || m.path.toLowerCase().includes(searchTerm) || m.chunk.toLowerCase().includes(searchTerm));
  rows = rows.slice().sort((a,b) => { let va=a[st.key], vb=b[st.key]; if (typeof va==='string') return va.localeCompare(vb)*st.dir; return (va-vb)*st.dir; });
  rows = rows.slice(0, 500);
  if (!rows.length) return '<div class="empty">无匹配模块</div>';
  let body = '';
  for (const m of rows) body += '<tr><td class="mname">'+esc(shortPath(m.path))+'</td><td class="cname" data-chunk="'+esc(m.chunk)+'">'+esc(m.chunk)+'</td><td>'+typeBadge(m.isEntry)+'</td><td class="num">'+fmt(m.kb)+'</td><td>'+bar(m.kb, maxModKb, m.isEntry?'#e03131':'#1c7ed6')+'</td></tr>';
  return '<div class="hint">top '+rows.length+' / '+modules.length+' 模块(按当前排序)</div>' + table([{key:'path',label:'module',sort:st.key==='path'?st.dir:0},{key:'chunk',label:'chunk',sort:st.key==='chunk'?st.dir:0},{key:'isEntry',label:'type',sort:st.key==='isEntry'?st.dir:0},{key:'kb',label:'size',sort:st.key==='kb'?st.dir:0},{key:'_bar',label:''}], body);
}

function renderDuplicates() {
  const st = sortState.dups;
  if (!duplicates.length) return '<div class="empty">无重复模块 — 没有同一模块出现在多个 chunk 中</div>';
  let rows = duplicates.filter(d => !searchTerm || d.path.toLowerCase().includes(searchTerm)).slice().sort((a,b)=>(a[st.key]-b[st.key])*st.dir);
  if (!rows.length) return '<div class="empty">无匹配</div>';
  let body = '';
  for (const d of rows) body += '<tr><td class="mname">'+esc(shortPath(d.path))+'</td><td class="num">'+d.count+'</td><td class="num">'+fmt(d.totalKb)+'</td><td>'+bar(d.totalKb, maxModKb, '#fab005')+'</td><td class="ftype">'+esc(d.chunks.map(c=>c.replace(/-[A-Za-z0-9_-]{8,}/,'')).join(' · '))+'</td></tr>';
  return '<div class="hint">同一模块被打进多个 chunk(可能可共享/去重)</div>' + table([{key:'path',label:'module',sort:st.key==='path'?st.dir:0},{key:'count',label:'chunks',sort:st.key==='count'?st.dir:0},{key:'totalKb',label:'total size',sort:st.key==='totalKb'?st.dir:0},{key:'_bar',label:''},{key:'_chunks',label:'in chunks'}], body);
}

function render() {
  const el = document.getElementById(activeTab);
  if (activeTab==='overview') el.innerHTML = renderOverview();
  else if (activeTab==='chunks') el.innerHTML = renderChunks();
  else if (activeTab==='modules') el.innerHTML = renderModules();
  else if (activeTab==='duplicates') el.innerHTML = renderDuplicates();
  el.querySelectorAll('th[data-key]').forEach(th => { th.onclick = () => { const t = activeTab; const key = th.dataset.key; if (key.startsWith('_')) return; const st = sortState[t]; if (st.key===key) st.dir*=-1; else { st.key=key; st.dir=-1; } render(); }; });
  el.querySelectorAll('[data-chunk]').forEach(n => { n.onclick = () => { searchTerm = n.dataset.chunk.toLowerCase(); document.getElementById('search').value = n.dataset.chunk; switchTab('modules'); }; });
}

function switchTab(t) { activeTab = t; document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab===t)); document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id===t)); render(); }

document.querySelectorAll('.tab').forEach(b => b.onclick = () => switchTab(b.dataset.tab));
document.getElementById('search').oninput = e => { searchTerm = e.target.value.toLowerCase(); render(); };
render();
</script>
</body></html>`;
};
