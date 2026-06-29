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

function readJson(relativePath) {
  try {
    return JSON.parse(readText(relativePath));
  } catch {
    return null;
  }
}

function normalizePath(value) {
  return value.replaceAll('\\', '/').replace(/\/+$/, '');
}

function expandWorkspaceGlobs(globs) {
  const workspacePaths = new Set();

  for (const raw of globs ?? []) {
    if (typeof raw !== 'string') continue;
    const pattern = normalizePath(raw.trim());
    if (!pattern) continue;

    if (pattern.endsWith('/*')) {
      const base = pattern.slice(0, -2);
      for (const dir of listDirs(base)) {
        if (exists(path.join(dir, 'package.json'))) workspacePaths.add(normalizePath(dir));
      }
      continue;
    }

    if (exists(path.join(pattern, 'package.json'))) workspacePaths.add(pattern);
  }

  return [...workspacePaths].sort();
}

function readWorkspaceGlobs(profile) {
  if (Array.isArray(profile.activeWorkspaceGlobs) && profile.activeWorkspaceGlobs.length > 0) {
    return profile.activeWorkspaceGlobs;
  }

  if (exists('pnpm-workspace.yaml')) {
    const workspaceConfig = parseSimpleYaml(readText('pnpm-workspace.yaml'));
    if (Array.isArray(workspaceConfig.packages)) return workspaceConfig.packages;
  }

  return Object.keys(profile.workspaces ?? {});
}

function ruleMatchesWorkspace(rule, workspacePath) {
  return (rule.paths ?? []).some((pattern) => {
    if (typeof pattern !== 'string') return false;
    const normalized = normalizePath(pattern);
    if (normalized === workspacePath) return true;
    if (normalized.startsWith(`${workspacePath}/`)) return true;
    if (normalized.startsWith(`${workspacePath}/*`)) return true;
    if (normalized.startsWith(`${workspacePath}/**`)) return true;
    return false;
  });
}

function workspaceKind(workspacePath) {
  if (workspacePath.startsWith('apps/')) return 'app';
  return 'package';
}

function packageScripts(manifest) {
  return Object.keys(manifest?.scripts ?? {}).sort();
}

function recommendedFallbackCommands(workspacePath, manifest, kind) {
  const name = manifest?.name;
  if (!name) return [];
  const scripts = packageScripts(manifest);
  const preferred = kind === 'app' ? ['typecheck', 'test', 'build'] : ['test', 'typecheck'];
  return preferred
    .filter((script) => scripts.includes(script))
    .map((script) => `pnpm --filter ${name} ${script}`);
}

function classifyWorkspaceReport(report) {
  const high = report.gaps.filter((gap) => gap.severity === 'high').length;
  const medium = report.gaps.filter((gap) => gap.severity === 'medium').length;
  if (high > 0) return 'missing';
  if (medium > 0 || !report.profileListed) return 'partial';
  return 'ready';
}

function buildWorkspaceReports(profile, validation) {
  const workspaceGlobs = readWorkspaceGlobs(profile);
  const activeWorkspaces = expandWorkspaceGlobs(workspaceGlobs);
  const profileWorkspaces = profile.workspaces ?? {};
  const validationRules = validation.pathRules ?? [];
  const reports = [];

  for (const workspacePath of activeWorkspaces) {
    const profileEntry = profileWorkspaces[workspacePath];
    const manifest = readJson(path.join(workspacePath, 'package.json'));
    const kind = profileEntry?.type ?? workspaceKind(workspacePath);
    const entryPath = profileEntry?.entry ?? path.join(workspacePath, 'AGENTS.md');
    const entry = { path: entryPath, exists: exists(entryPath) };
    const knowledge = Object.entries(profileEntry?.knowledge ?? {})
      .filter(([, target]) => typeof target === 'string')
      .map(([kindName, target]) => ({
        kind: kindName,
        path: target,
        exists: exists(target),
      }));
    const rules = validationRules.filter((rule) => ruleMatchesWorkspace(rule, workspacePath));
    const commands = [
      ...new Set(rules.flatMap((rule) => Array.isArray(rule.required) ? rule.required : [])),
    ];
    const fallbackCommands = recommendedFallbackCommands(workspacePath, manifest, kind);
    const gaps = [];

    if (!profileEntry) {
      gaps.push({
        severity: 'medium',
        type: 'profile',
        label: 'No explicit profile entry',
        path: 'harness/profile.yaml',
        detail: 'This workspace falls back to workspaceTypeDefaults instead of a curated entry.',
      });
    }
    if (!entry.exists) {
      gaps.push({
        severity: 'high',
        type: 'entry',
        label: 'Missing local AGENTS entry',
        path: entry.path,
        detail: 'Workspace has no local harness entry for progressive reading.',
      });
    }
    for (const item of knowledge) {
      if (!item.exists) {
        gaps.push({
          severity: 'high',
          type: 'knowledge',
          label: `Missing ${item.kind}`,
          path: item.path,
          detail: 'Profile points to a file that does not exist.',
        });
      }
    }
    if (rules.length === 0) {
      gaps.push({
        severity: 'medium',
        type: 'validation',
        label: 'No path-specific validation rule',
        path: 'harness/validation.yaml',
        detail: 'Validation falls back to workspace scripts instead of a named path rule.',
      });
    }

    const report = {
      path: workspacePath,
      type: kind,
      packageName: profileEntry?.packageName ?? manifest?.name ?? path.basename(workspacePath),
      role: profileEntry?.role ?? 'default-workspace',
      profileListed: Boolean(profileEntry),
      entry,
      knowledge,
      validationRules: rules.map((rule) => ({
        name: rule.name,
        paths: rule.paths ?? [],
        required: rule.required ?? [],
        manual: rule.manual ?? [],
        optional: rule.optional ?? [],
        escalateWhen: rule.escalateWhen ?? {},
      })),
      commands: commands.length > 0 ? commands : fallbackCommands,
      fallbackCommands,
      scripts: packageScripts(manifest),
      gaps,
      readingPath: [
        'AGENTS.md',
        'harness/README.md',
        'harness/profile.yaml',
        entry.path,
        ...knowledge.filter((item) => item.exists).map((item) => item.path),
      ],
    };
    report.status = classifyWorkspaceReport(report);
    report.score = Math.max(0, 100 - report.gaps.reduce((sum, gap) => sum + (gap.severity === 'high' ? 35 : 18), 0));
    reports.push(report);
  }

  return reports.sort((a, b) => a.path.localeCompare(b.path));
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
  const workspaceReports = buildWorkspaceReports(profile, validation);

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
  const harnessGaps = workspaceReports.flatMap((report) =>
    report.gaps.map((gap) => ({
      workspace: report.path,
      packageName: report.packageName,
      ...gap,
    })),
  );
  const explicitWorkspaceCount = workspaceReports.filter((report) => report.profileListed).length;
  const validationCoverageCount = workspaceReports.filter((report) => report.validationRules.length > 0).length;
  const entryCoverageCount = workspaceReports.filter((report) => report.entry.exists).length;
  return {
    generatedAt: new Date().toISOString(),
    summary: {
      nodes: nodeList.length,
      edges: edges.length,
      workspaces: nodeList.filter((node) => node.type === 'workspace').length,
      activeWorkspaces: workspaceReports.length,
      explicitWorkspaces: explicitWorkspaceCount,
      entryCoverage: entryCoverageCount,
      validationCoverage: validationCoverageCount,
      skills: nodeList.filter((node) => node.type === 'skill').length,
      tools: nodeList.filter((node) => node.type === 'tool').length,
      graphGaps: gapCount,
      harnessGaps: harnessGaps.length,
      highSeverityGaps: harnessGaps.filter((gap) => gap.severity === 'high').length,
    },
    profileScope: profile.profileScope ?? {},
    activeWorkspaceGlobs: readWorkspaceGlobs(profile),
    workspaceReports,
    harnessGaps,
    nodes: nodeList,
    edges,
  };
}

function html(graph) {
  const graphJson = JSON.stringify(graph).replaceAll('<', '\\u003c');
  return `<!doctype html>
<html lang="zh-Hans">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Harness 看板</title>
<style>
:root {
  color-scheme: dark;
  --bg:#0f1115;
  --panel:#171a20;
  --panel-2:#1e232b;
  --panel-3:#242a33;
  --line:#343b47;
  --text:#eef2f7;
  --muted:#9ea9b8;
  --blue:#7db7ff;
  --green:#7ee2a8;
  --yellow:#f3cd6b;
  --red:#ff7a70;
  --purple:#c8a2ff;
  --teal:#7ee4df;
}
* { box-sizing: border-box; }
body {
  margin:0;
  background:var(--bg);
  color:var(--text);
  font:14px/1.45 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
button, input { font:inherit; }
.topbar { border-bottom:1px solid var(--line); background:#12151a; padding:18px 24px; }
.topline { display:flex; justify-content:space-between; align-items:flex-start; gap:16px; }
h1 { margin:0; font-size:24px; line-height:1.15; letter-spacing:0; }
h2 { margin:0 0 12px; font-size:15px; letter-spacing:0; }
h3 { margin:0 0 8px; font-size:13px; color:var(--muted); letter-spacing:0; text-transform:uppercase; }
.sub { color:var(--muted); margin-top:6px; max-width:880px; }
.meta { color:var(--muted); font-size:12px; text-align:right; white-space:nowrap; }
.meta-panel { display:grid; gap:8px; justify-items:end; }
.language-switch { display:flex; gap:6px; justify-content:flex-end; }
.language-switch button { min-height:30px; padding:6px 9px; font-size:12px; }
.tabs { display:flex; gap:8px; flex-wrap:wrap; margin-top:16px; }
button {
  border:1px solid var(--line);
  background:var(--panel);
  color:var(--text);
  padding:8px 10px;
  border-radius:6px;
  cursor:pointer;
  min-height:34px;
}
button:hover, button.active { border-color:var(--blue); color:var(--blue); }
.shell { display:grid; grid-template-columns:minmax(0, 1fr) minmax(360px, 420px); gap:0; min-height:calc(100vh - 115px); }
main { min-width:0; padding:22px 24px 36px; }
.detail { border-left:1px solid var(--line); background:var(--panel); padding:22px; overflow:auto; }
.view { display:none; }
.view.active { display:block; }
.metrics { display:grid; grid-template-columns:repeat(4, minmax(150px, 1fr)); gap:12px; margin-bottom:18px; }
.metric { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:14px; min-height:88px; }
.metric b { display:block; font-size:25px; line-height:1.1; margin-bottom:7px; }
.metric span { color:var(--muted); font-size:12px; }
.metric.good b { color:var(--green); }
.metric.warn b { color:var(--yellow); }
.metric.bad b { color:var(--red); }
.grid-2 { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
.panel { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:16px; margin-bottom:14px; }
.coverage-bar { height:10px; background:#0c0f13; border:1px solid var(--line); border-radius:8px; overflow:hidden; }
.coverage-bar span { display:block; height:100%; background:linear-gradient(90deg, var(--green), var(--blue)); }
.compact-list { display:grid; gap:8px; }
.compact-row, .workspace-card, .gap-row {
  border:1px solid var(--line);
  background:var(--panel-2);
  border-radius:8px;
  padding:12px;
}
.workspace-card { cursor:pointer; min-height:158px; display:grid; gap:10px; align-content:start; }
.workspace-card:hover, .workspace-card.active { border-color:var(--blue); }
.workspace-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(280px, 1fr)); gap:12px; }
.filters { display:flex; gap:10px; flex-wrap:wrap; align-items:center; margin-bottom:14px; }
.search { flex:1; min-width:240px; border:1px solid var(--line); background:#101319; color:var(--text); border-radius:6px; padding:9px 10px; min-height:38px; }
.badges { display:flex; flex-wrap:wrap; gap:6px; }
.badge { border:1px solid var(--line); border-radius:999px; padding:3px 7px; color:var(--muted); font-size:12px; line-height:1.2; }
.badge.ready { color:var(--green); border-color:#35634b; }
.badge.partial { color:var(--yellow); border-color:#6a5730; }
.badge.missing { color:var(--red); border-color:#703c38; }
.badge.info { color:var(--blue); border-color:#355475; }
.path { font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; word-break:break-word; }
.muted { color:var(--muted); }
.row-title { display:flex; justify-content:space-between; gap:12px; align-items:flex-start; }
.score { font-weight:700; color:var(--teal); }
.gap-row { display:grid; grid-template-columns:120px minmax(0, 1fr); gap:12px; margin-bottom:10px; }
.severity { font-weight:700; }
.severity.high { color:var(--red); }
.severity.medium { color:var(--yellow); }
.command { display:grid; grid-template-columns:minmax(0, 1fr) auto; gap:8px; align-items:center; margin-bottom:8px; }
.command code, code, pre { font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
.command code { display:block; background:#0c0f13; border:1px solid var(--line); border-radius:6px; padding:8px; overflow:auto; white-space:pre-wrap; word-break:break-word; }
pre { white-space:pre-wrap; word-break:break-word; background:#0c0f13; border:1px solid var(--line); border-radius:6px; padding:10px; color:#dce5ef; margin:0; }
.mini-table { display:grid; gap:8px; }
.mini-row { display:grid; grid-template-columns:110px minmax(0, 1fr); gap:10px; padding:8px 0; border-bottom:1px solid var(--line); }
.mini-row:last-child { border-bottom:0; }
.reading { display:grid; gap:8px; counter-reset:readstep; }
.reading div { border:1px solid var(--line); background:var(--panel-2); border-radius:6px; padding:8px; }
.reading div::before { counter-increment:readstep; content:counter(readstep) ". "; color:var(--blue); font-weight:700; }
.empty { color:var(--muted); border:1px dashed var(--line); border-radius:8px; padding:16px; }
@media (max-width: 1180px) {
  .shell, .grid-2 { grid-template-columns:1fr; }
  .detail { border-left:0; border-top:1px solid var(--line); }
  .metrics { grid-template-columns:repeat(2, minmax(150px, 1fr)); }
  .meta { text-align:left; white-space:normal; }
  .meta-panel { justify-items:start; }
  .language-switch { justify-content:flex-start; }
  .topline { flex-direction:column; }
}
@media (max-width: 620px) {
  .topbar, main, .detail { padding-left:14px; padding-right:14px; }
  .metrics { grid-template-columns:1fr; }
  .gap-row, .mini-row { grid-template-columns:1fr; }
}
</style>
</head>
<body>
<header class="topbar">
  <div class="topline">
    <div>
      <h1 data-i18n="pageTitle">仓库 Harness 看板</h1>
      <div class="sub" data-i18n="subtitle">快速查看 harness 覆盖、工作区指引、验证命令和当前缺失项。</div>
    </div>
    <div class="meta-panel">
      <div class="language-switch" aria-label="Language">
        <button class="active" data-lang="zh">中文</button>
        <button data-lang="en">English</button>
      </div>
      <div class="meta" id="meta"></div>
    </div>
  </div>
  <nav class="tabs" aria-label="Harness views">
    <button class="active" data-tab="overview" data-i18n="tabOverview">总览</button>
    <button data-tab="workspaces" data-i18n="tabWorkspaces">工作区</button>
    <button data-tab="gaps" data-i18n="tabMissing">缺失</button>
  </nav>
</header>
<div class="shell">
  <main>
    <section id="overview" class="view active">
      <div class="metrics" id="metrics"></div>
      <div class="grid-2">
        <section class="panel">
          <h2 data-i18n="harnessHealth">Harness 健康度</h2>
          <div id="health"></div>
        </section>
        <section class="panel">
          <h2 data-i18n="priorityMissing">优先缺失项</h2>
          <div id="priority-gaps"></div>
        </section>
      </div>
      <section class="panel">
        <h2 data-i18n="readingLoop">渐进阅读路径</h2>
        <div class="compact-list" id="reading-loop"></div>
      </section>
    </section>

    <section id="workspaces" class="view">
      <div class="filters">
        <input id="workspace-search" class="search" type="search" data-i18n-placeholder="workspaceSearch" placeholder="搜索工作区、包、角色或命令" />
        <button class="active" data-filter="all" data-i18n="filterAll">全部</button>
        <button data-filter="ready" data-i18n="filterReady">就绪</button>
        <button data-filter="partial" data-i18n="filterPartial">部分</button>
        <button data-filter="missing" data-i18n="filterMissing">缺失</button>
      </div>
      <div class="workspace-grid" id="workspace-grid"></div>
    </section>

    <section id="gaps" class="view">
      <section class="panel">
        <h2 data-i18n="currentMissing">当前 Harness 缺失项</h2>
        <div id="gap-list"></div>
      </section>
    </section>

  </main>
  <aside class="detail">
    <h2 id="detail-title" data-i18n="workspaceDetail">工作区详情</h2>
    <div id="detail-body"></div>
  </aside>
</div>
<script>
const graph = ${graphJson};
const reports = graph.workspaceReports || [];
const gaps = graph.harnessGaps || [];
const byWorkspace = new Map(reports.map(r => [r.path, r]));
const messages = {
  zh: {
    title: 'Harness 看板',
    pageTitle: '仓库 Harness 看板',
    subtitle: '快速查看 harness 覆盖、工作区指引、验证命令和当前缺失项。',
    tabOverview: '总览',
    tabWorkspaces: '工作区',
    tabMissing: '缺失',
    harnessHealth: 'Harness 健康度',
    priorityMissing: '优先缺失项',
    readingLoop: '渐进阅读路径',
    workspaceSearch: '搜索工作区、包、角色或命令',
    filterAll: '全部',
    filterReady: '就绪',
    filterPartial: '部分',
    filterMissing: '缺失',
    currentMissing: '当前 Harness 缺失项',
    workspaceDetail: '工作区详情',
  },
  en: {
    title: 'Harness Dashboard',
    pageTitle: 'Repository Harness Dashboard',
    subtitle: 'Operational view of harness coverage, workspace guidance, validation commands, and missing pieces.',
    tabOverview: 'Overview',
    tabWorkspaces: 'Workspaces',
    tabMissing: 'Missing',
    harnessHealth: 'Harness Health',
    priorityMissing: 'Priority Missing Items',
    readingLoop: 'Progressive Reading Loop',
    workspaceSearch: 'Search workspace, package, role, or command',
    filterAll: 'All',
    filterReady: 'Ready',
    filterPartial: 'Partial',
    filterMissing: 'Missing',
    currentMissing: 'Current Harness Missing Items',
    workspaceDetail: 'Workspace Detail',
  },
};
const savedLang = localStorage.getItem('harness-dashboard-lang');
const state = { selected: reports[0]?.path || '', filter: 'all', query: '', lang: savedLang === 'en' ? 'en' : 'zh' };

function escapeHtml(s){ return String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function radius(n){ return n.type==='workspace'?10:n.type==='gap'?9:6; }
function pct(part, total){ return total ? Math.round(part / total * 100) : 100; }
function t(key){ return messages[state.lang]?.[key] ?? messages.zh[key] ?? key; }
function bi(zh, en){ return state.lang === 'en' ? en : zh; }
function countLabel(count, zhUnit, enSingular, enPlural){ return state.lang === 'en' ? count + ' ' + (count === 1 ? enSingular : enPlural) : count + zhUnit; }
function statusLabel(status){ return status === 'ready' ? bi('就绪', 'Ready') : status === 'missing' ? bi('缺失', 'Missing') : bi('部分', 'Partial'); }
function statusBadge(status){ return '<span class="badge '+status+'">'+statusLabel(status)+'</span>'; }
function severityLabel(severity){ return severity === 'high' ? bi('高', 'HIGH') : severity === 'medium' ? bi('中', 'MEDIUM') : String(severity ?? '').toUpperCase(); }
function typeLabel(type){
  const labels = {
    profile: bi('Profile', 'profile'),
    entry: bi('入口', 'entry'),
    knowledge: bi('知识', 'knowledge'),
    validation: bi('验证', 'validation'),
  };
  return labels[type] ?? type;
}
function gapLabel(gap){
  if (gap.label === 'No explicit profile entry') return bi('未显式配置 profile 条目', 'No explicit profile entry');
  if (gap.label === 'Missing local AGENTS entry') return bi('缺少本地 AGENTS 入口', 'Missing local AGENTS entry');
  if (gap.label === 'No path-specific validation rule') return bi('缺少路径级验证规则', 'No path-specific validation rule');
  if (String(gap.label).startsWith('Missing ')) return bi('缺少 ' + String(gap.label).replace(/^Missing\s+/, ''), gap.label);
  return gap.label;
}
function gapDetail(gap){
  if (gap.detail === 'This workspace falls back to workspaceTypeDefaults instead of a curated entry.') {
    return bi('该工作区会退回 workspaceTypeDefaults，没有单独精修条目。', gap.detail);
  }
  if (gap.detail === 'Workspace has no local harness entry for progressive reading.') {
    return bi('该工作区缺少用于渐进阅读的本地 harness 入口。', gap.detail);
  }
  if (gap.detail === 'Profile points to a file that does not exist.') {
    return bi('profile 指向了不存在的文件。', gap.detail);
  }
  if (gap.detail === 'Validation falls back to workspace scripts instead of a named path rule.') {
    return bi('验证会退回 workspace 脚本，而不是命名路径规则。', gap.detail);
  }
  return gap.detail || '';
}
function missingText(){ return bi('未发现 harness 缺失项', 'No missing harness items detected'); }
function metric(label, value, sub, tone){
  return '<div class="metric '+(tone || '')+'"><b>'+escapeHtml(value)+'</b><span>'+escapeHtml(label)+'</span><div class="muted">'+escapeHtml(sub || '')+'</div></div>';
}
function renderStaticText(){
  document.documentElement.lang = state.lang === 'en' ? 'en' : 'zh-Hans';
  document.title = t('title');
  document.querySelectorAll('[data-i18n]').forEach(element => {
    element.textContent = t(element.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(element => {
    element.setAttribute('placeholder', t(element.dataset.i18nPlaceholder));
  });
  document.querySelectorAll('[data-lang]').forEach(button => {
    button.classList.toggle('active', button.dataset.lang === state.lang);
  });
}
function renderMeta(){
  const scope = graph.profileScope?.mode ? (state.lang === 'en' ? graph.profileScope.mode + ' scope' : graph.profileScope.mode + ' 范围') : 'profile';
  document.getElementById('meta').innerHTML = escapeHtml(scope)+'<br><span>'+escapeHtml(new Date(graph.generatedAt).toLocaleString())+'</span>';
}
function renderMetrics(){
  const total = graph.summary.activeWorkspaces || reports.length;
  const entryPct = pct(graph.summary.entryCoverage, total);
  const validationPct = pct(graph.summary.validationCoverage, total);
  document.getElementById('metrics').innerHTML = [
    metric(bi('活跃工作区', 'Active workspaces'), total, countLabel(graph.summary.explicitWorkspaces, ' 个精修条目', 'curated entry', 'curated entries'), 'good'),
    metric(bi('入口覆盖', 'Entry coverage'), entryPct + '%', countLabel(graph.summary.entryCoverage, ' 个有本地入口', 'has local entry', 'have local entries'), entryPct === 100 ? 'good' : 'warn'),
    metric(bi('验证覆盖', 'Validation coverage'), validationPct + '%', countLabel(graph.summary.validationCoverage, ' 个有路径规则', 'has path rule', 'have path rules'), validationPct === 100 ? 'good' : 'warn'),
    metric(bi('缺失项', 'Missing items'), graph.summary.harnessGaps, countLabel(graph.summary.highSeverityGaps, ' 个高优先级', 'high severity', 'high severity'), graph.summary.highSeverityGaps ? 'bad' : graph.summary.harnessGaps ? 'warn' : 'good'),
  ].join('');
}
function renderHealth(){
  const total = graph.summary.activeWorkspaces || reports.length;
  const rows = [
    [bi('Profile 条目', 'Profile entries'), graph.summary.explicitWorkspaces, total],
    [bi('本地入口', 'Local entries'), graph.summary.entryCoverage, total],
    [bi('验证规则', 'Validation rules'), graph.summary.validationCoverage, total],
  ];
  document.getElementById('health').innerHTML = rows.map(([label, count, max]) => {
    const value = pct(count, max);
    return '<div class="compact-row"><div class="row-title"><strong>'+escapeHtml(label)+'</strong><span class="score">'+value+'%</span></div><div class="coverage-bar" aria-label="'+escapeHtml(label)+' coverage"><span style="width:'+value+'%"></span></div><div class="muted">'+count+' / '+max+'</div></div>';
  }).join('');
}
function renderPriorityGaps(){
  const priority = gaps.filter(g => g.severity === 'high').slice(0, 4).concat(gaps.filter(g => g.severity !== 'high').slice(0, Math.max(0, 4 - gaps.filter(g => g.severity === 'high').length)));
  document.getElementById('priority-gaps').innerHTML = priority.length ? priority.map(renderGapRow).join('') : '<div class="empty">'+missingText()+'</div>';
}
function renderReadingLoop(){
  const loop = [
    bi('根入口：AGENTS.md / CLAUDE.md', 'Root entry: AGENTS.md / CLAUDE.md'),
    bi('Harness 总览：harness/README.md', 'Harness overview: harness/README.md'),
    bi('机器可读地图：harness/profile.yaml', 'Machine-readable map: harness/profile.yaml'),
    bi('受影响工作区入口：workspace AGENTS.md', 'Affected workspace entry: workspace AGENTS.md'),
    bi('按需阅读 contracts、runbook 或 validation 文档', 'Read contracts, runbook, or validation docs as needed'),
  ];
  document.getElementById('reading-loop').innerHTML = loop.map((item, i) => '<div class="compact-row"><strong>'+(i + 1)+'. '+escapeHtml(item)+'</strong></div>').join('');
}
function filteredReports(){
  const query = state.query.trim().toLowerCase();
  return reports.filter(report => {
    if (state.filter !== 'all' && report.status !== state.filter) return false;
    if (!query) return true;
    const gapSearch = report.gaps.flatMap(gap => [gap.label, gap.detail, gapLabel(gap), gapDetail(gap)]);
    const haystack = [report.path, report.packageName, report.role, report.type, report.status, statusLabel(report.status), ...report.commands, ...report.scripts, ...gapSearch].join(' ').toLowerCase();
    return haystack.includes(query);
  });
}
function renderWorkspaceCard(report){
  const gapText = report.gaps.length === 0 ? bi('无缺失项', 'No missing items') : countLabel(report.gaps.length, ' 个缺失项', 'missing item', 'missing items');
  const commandCount = countLabel(report.commands.length, ' 条命令', 'command', 'commands');
  return '<article class="workspace-card '+(state.selected === report.path ? 'active' : '')+'" data-workspace="'+escapeHtml(report.path)+'">'+
    '<div class="row-title"><strong class="path">'+escapeHtml(report.path)+'</strong><span class="score">'+report.score+'</span></div>'+
    '<div class="muted">'+escapeHtml(report.role)+' / '+escapeHtml(report.packageName)+'</div>'+
    '<div class="badges">'+statusBadge(report.status)+'<span class="badge info">'+escapeHtml(report.type)+'</span><span class="badge">'+commandCount+'</span></div>'+
    '<div class="muted">'+escapeHtml(gapText)+'</div>'+
  '</article>';
}
function renderWorkspaces(){
  const items = filteredReports();
  document.getElementById('workspace-grid').innerHTML = items.length ? items.map(renderWorkspaceCard).join('') : '<div class="empty">'+bi('当前筛选无匹配工作区', 'No workspaces match the current filter')+'</div>';
}
function renderGapRow(gap){
  return '<div class="gap-row">'+
    '<div><span class="severity '+escapeHtml(gap.severity)+'">'+escapeHtml(severityLabel(gap.severity))+'</span><div class="muted">'+escapeHtml(typeLabel(gap.type))+'</div></div>'+
    '<div><strong>'+escapeHtml(gapLabel(gap))+'</strong><div class="path">'+escapeHtml(gap.workspace || gap.path)+'</div><div class="muted">'+escapeHtml(gapDetail(gap))+'</div></div>'+
  '</div>';
}
function renderGaps(){
  document.getElementById('gap-list').innerHTML = gaps.length ? gaps.map(renderGapRow).join('') : '<div class="empty">'+missingText()+'</div>';
}
function renderCommands(commands){
  if (!commands.length) return '<div class="empty">'+bi('未解析到验证命令', 'No validation commands resolved')+'</div>';
  return commands.map(command => '<div class="command"><code>'+escapeHtml(command)+'</code><button data-copy="'+escapeHtml(command)+'">'+bi('复制', 'Copy')+'</button></div>').join('');
}
function renderDetail(){
  const report = byWorkspace.get(state.selected) || reports[0];
  if (!report) {
    document.getElementById('detail-title').textContent = bi('工作区详情', 'Workspace Detail');
    document.getElementById('detail-body').innerHTML = '<div class="empty">'+bi('未找到工作区数据', 'No workspace data found')+'</div>';
    return;
  }
  document.getElementById('detail-title').textContent = report.path;
  const knowledge = report.knowledge.length ? report.knowledge.map(item => '<div class="mini-row"><div>'+escapeHtml(item.kind)+'</div><div class="path">'+escapeHtml(item.path)+' '+(item.exists ? '' : '<span class="severity high">'+bi('缺失', 'missing')+'</span>')+'</div></div>').join('') : '<div class="empty">'+bi('无已配置知识引用', 'No curated knowledge refs')+'</div>';
  const missing = report.gaps.length ? report.gaps.map(renderGapRow).join('') : '<div class="empty">'+bi('该工作区无缺失项', 'No missing items for this workspace')+'</div>';
  document.getElementById('detail-body').innerHTML =
    '<div class="badges">'+statusBadge(report.status)+'<span class="badge info">'+escapeHtml(report.type)+'</span><span class="badge">'+escapeHtml(state.lang === 'en' ? report.score + ' score' : report.score + ' 分')+'</span></div>'+
    '<section class="panel"><h3>'+bi('身份信息', 'Identity')+'</h3><div class="mini-table">'+
      '<div class="mini-row"><div>'+bi('包', 'Package')+'</div><div>'+escapeHtml(report.packageName)+'</div></div>'+
      '<div class="mini-row"><div>'+bi('角色', 'Role')+'</div><div>'+escapeHtml(report.role)+'</div></div>'+
      '<div class="mini-row"><div>'+bi('入口', 'Entry')+'</div><div class="path">'+escapeHtml(report.entry.path)+' '+(report.entry.exists ? '' : '<span class="severity high">'+bi('缺失', 'missing')+'</span>')+'</div></div>'+
      '<div class="mini-row"><div>Profile</div><div>'+escapeHtml(report.profileListed ? bi('已精修', 'curated') : bi('默认兜底', 'default fallback'))+'</div></div>'+
    '</div></section>'+
    '<section class="panel"><h3>'+bi('验证', 'Validation')+'</h3>'+renderCommands(report.commands)+'</section>'+
    '<section class="panel"><h3>'+bi('阅读路径', 'Reading Path')+'</h3><div class="reading">'+report.readingPath.map(item => '<div class="path">'+escapeHtml(item)+'</div>').join('')+'</div></section>'+
    '<section class="panel"><h3>'+bi('知识引用', 'Knowledge')+'</h3>'+knowledge+'</section>'+
    '<section class="panel"><h3>'+bi('缺失项', 'Missing')+'</h3>'+missing+'</section>';
}
function showTab(tab){
  document.querySelectorAll('.tabs button').forEach(button => button.classList.toggle('active', button.dataset.tab === tab));
  document.querySelectorAll('.view').forEach(view => view.classList.toggle('active', view.id === tab));
}
function init(){
  renderStaticText(); renderMeta(); renderMetrics(); renderHealth(); renderPriorityGaps(); renderReadingLoop(); renderWorkspaces(); renderGaps(); renderDetail();
  document.querySelector('.language-switch').addEventListener('click', e => {
    const button = e.target.closest('button[data-lang]'); if(!button) return;
    state.lang = button.dataset.lang === 'en' ? 'en' : 'zh';
    localStorage.setItem('harness-dashboard-lang', state.lang);
    renderStaticText(); renderMeta(); renderMetrics(); renderHealth(); renderPriorityGaps(); renderReadingLoop(); renderWorkspaces(); renderGaps(); renderDetail();
  });
  document.querySelector('.tabs').addEventListener('click', e => { const button = e.target.closest('button[data-tab]'); if(button) showTab(button.dataset.tab); });
  document.querySelector('.filters').addEventListener('click', e => {
    const button = e.target.closest('button[data-filter]'); if(!button) return;
    state.filter = button.dataset.filter;
    document.querySelectorAll('button[data-filter]').forEach(item => item.classList.toggle('active', item === button));
    renderWorkspaces();
  });
  document.getElementById('workspace-search').addEventListener('input', e => { state.query = e.target.value; renderWorkspaces(); });
  document.getElementById('workspace-grid').addEventListener('click', e => {
    const card = e.target.closest('[data-workspace]'); if(!card) return;
    state.selected = card.dataset.workspace; renderWorkspaces(); renderDetail();
  });
  document.body.addEventListener('click', e => {
    const copy = e.target.closest('button[data-copy]'); if(!copy) return;
    navigator.clipboard?.writeText(copy.dataset.copy).then(() => { copy.textContent = bi('已复制', 'Copied'); setTimeout(() => { copy.textContent = bi('复制', 'Copy'); }, 1100); });
  });
}
init();
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
  if (graph.harnessGaps?.length) {
    console.log('\nHarness gaps:');
    for (const gap of graph.harnessGaps) {
      console.log(`- [${gap.severity}] ${gap.workspace}: ${gap.label} (${gap.path})`);
    }
  }
}

if (process.argv.includes('--once')) {
  const graph = buildGraph();
  printSummary(graph);
  process.exit(0);
}

const portArg = process.argv.find((arg) => arg.startsWith('--port='));
const preferredPort = portArg ? Number(portArg.split('=')[1]) : 4177;
const server = http.createServer((req, res) => {
  const graph = buildGraph();
  if (req.url === '/graph.json') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(graph, null, 2));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html(graph));
});
server.listen(preferredPort, '127.0.0.1', () => {
  console.log(`Harness dashboard: http://127.0.0.1:${preferredPort}`);
});
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      console.log(`Harness dashboard: http://127.0.0.1:${address.port}`);
    });
    return;
  }
  throw error;
});
