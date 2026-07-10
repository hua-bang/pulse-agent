import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const scopes = new Set(['root', 'engine', 'canvas-workspace']);

function countFiles(relativePath, predicate = () => true) {
  const directory = path.join(repoRoot, relativePath);
  let count = 0;
  const visit = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const child = path.join(current, entry.name);
      if (entry.isDirectory()) visit(child);
      else if (predicate(entry.name)) count += 1;
    }
  };
  visit(directory);
  return count;
}

function countDirectories(relativePath) {
  return fs.readdirSync(path.join(repoRoot, relativePath), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .length;
}

function scopeData(locale, english, chinese) {
  return locale === 'zh' ? chinese : english;
}

function branch(id, locale, english, chinese) {
  return { id, ...scopeData(locale, english, chinese) };
}

function rootGraph(locale) {
  const workspaceCount = countDirectories('packages') + 3;
  const validationCount = workspaceCount;
  return {
    title: scopeData(locale, 'Repository Harness Reading Graph', '仓库 Harness 阅读图'),
    subtitle: scopeData(locale, 'Routes from root rules to workspace-owned evidence.', '从根规则通向各工作区证据的阅读路径。'),
    scope: 'root',
    metrics: [
      { value: String(workspaceCount), label: scopeData(locale, 'active workspaces', '活跃工作区') },
      { value: String(validationCount), label: scopeData(locale, 'validation definitions', '校验定义') },
      { value: String(countFiles('harness/skills', (name) => name === 'SKILL.md')), label: scopeData(locale, 'root harness skills', '根 Harness 技能') },
      { value: '5', label: scopeData(locale, 'harness surfaces', 'Harness 表面') },
    ],
    entryNodes: scopeData(locale,
      [{ title: 'AGENTS.md', detail: 'Repository-wide routing, constraints, and acceptance.' }, { title: 'harness/README.md', detail: 'Progressive route into the owning workspace.' }],
      [{ title: 'AGENTS.md', detail: '仓库级路由、约束与验收标准。' }, { title: 'harness/README.md', detail: '渐进式进入实际拥有该任务的工作区。' }]),
    branches: [
      branch('workspace-change', locale,
        { label: 'Change a workspace', intent: ['Find the owning package or app', 'Use local validation first'], sources: ['pnpm-workspace.yaml', '<workspace>/AGENTS.md', '<workspace>/harness/validate/validation.yaml'], reads: ['Workspace membership is owned by pnpm-workspace.yaml', 'Local contracts and commands belong to the workspace'], evidence: ['Run node scripts/harness/run-harness-check.mjs', 'Report commands actually run'], level: 4 },
        { label: '修改某个工作区', intent: ['定位拥有该功能的包或应用', '优先使用本地校验'], sources: ['pnpm-workspace.yaml', '<workspace>/AGENTS.md', '<workspace>/harness/validate/validation.yaml'], reads: ['pnpm-workspace.yaml 是工作区成员的唯一来源', '局部契约和命令由工作区拥有'], evidence: ['运行 node scripts/harness/run-harness-check.mjs', '仅报告实际执行的命令'], level: 4 }),
      branch('cross-workspace-contract', locale,
        { label: 'Change a shared contract', intent: ['Identify downstream consumers', 'Apply root impact escalation'], sources: ['harness/validate/validation.yaml', 'packages/engine/harness/knowledge/contracts.md', 'consumer AGENTS.md files'], reads: ['Root owns cross-workspace impact rules', 'Consumer checks supplement local validation'], evidence: ['Runner prints reminder-only escalation rules', 'Run affected consumer checks deliberately'], level: 4 },
        { label: '修改跨工作区契约', intent: ['识别下游消费者', '应用根级影响升级规则'], sources: ['harness/validate/validation.yaml', 'packages/engine/harness/knowledge/contracts.md', '消费者 AGENTS.md 文件'], reads: ['根目录拥有跨工作区影响规则', '消费者检查补充本地校验'], evidence: ['Runner 会输出仅提醒的升级规则', '有意识地运行受影响消费者检查'], level: 4 }),
    ],
  };
}

function engineGraph(locale) {
  return {
    title: scopeData(locale, 'Engine Harness Reading Graph', 'Engine Harness 阅读图'),
    subtitle: scopeData(locale, 'Routes for the reusable Pulse Coder runtime.', '可复用 Pulse Coder 运行时的阅读路径。'),
    scope: 'packages/engine',
    metrics: [
      { value: String(countDirectories('packages/engine/src/built-in')), label: scopeData(locale, 'built-in plugin directories', '内置插件目录') },
      { value: String(countFiles('packages/engine/src/tools', (name) => name.endsWith('.ts'))), label: scopeData(locale, 'tool source files', '工具源码文件') },
      { value: String(countFiles('packages/engine/harness/knowledge', (name) => name.endsWith('.md'))), label: scopeData(locale, 'knowledge documents', '知识文档') },
      { value: '2', label: scopeData(locale, 'public barrels', '公开导出桶') },
    ],
    entryNodes: scopeData(locale,
      [{ title: 'AGENTS.md', detail: 'Root constraints and cross-consumer impact.' }, { title: 'packages/engine/AGENTS.md', detail: 'Engine contracts, extension points, and checks.' }],
      [{ title: 'AGENTS.md', detail: '根级约束与跨消费者影响。' }, { title: 'packages/engine/AGENTS.md', detail: 'Engine 契约、扩展点与检查。' }]),
    branches: [
      branch('public-api', locale,
        { label: 'Change a public API', intent: ['Protect both public barrels', 'Check downstream consumers'], sources: ['harness/knowledge/contracts.md', 'src/index.ts', 'src/built-in/index.ts'], reads: ['The public API has two export barrels', 'CLI, remote server, canvas, ACP, and plugins consume Engine contracts'], evidence: ['Build Engine', 'Apply root enginePublicApiChange escalation'], level: 4 },
        { label: '修改公开 API', intent: ['保护两个公开导出桶', '检查下游消费者'], sources: ['harness/knowledge/contracts.md', 'src/index.ts', 'src/built-in/index.ts'], reads: ['公开 API 有两个导出桶', 'CLI、远程服务、Canvas、ACP 与插件消费 Engine 契约'], evidence: ['构建 Engine', '应用根级 enginePublicApiChange 升级规则'], level: 4 }),
      branch('tool-or-plugin', locale,
        { label: 'Add a tool or built-in plugin', intent: ['Use extension points before core-loop edits', 'Preserve merge and loading order'], sources: ['harness/knowledge/tools-reference.md', 'harness/knowledge/plugin-system.md', 'src/tools/index.ts', 'src/built-in/index.ts'], reads: ['Tools must be non-blocking and shell-safe', 'Hosts can disable default plugins and assemble their own list'], evidence: ['Run focused tests', 'Run describe-engine after a build'], level: 4 },
        { label: '新增工具或内置插件', intent: ['先使用扩展点，后考虑修改核心循环', '保持合并与加载顺序'], sources: ['harness/knowledge/tools-reference.md', 'harness/knowledge/plugin-system.md', 'src/tools/index.ts', 'src/built-in/index.ts'], reads: ['工具必须非阻塞且 Shell 安全', '宿主可禁用默认插件并自组装列表'], evidence: ['运行聚焦测试', '构建后运行 describe-engine'], level: 4 }),
    ],
  };
}

function canvasGraph(locale) {
  return {
    title: scopeData(locale, 'Pulse Canvas Harness Reading Graph', 'Pulse Canvas Harness 阅读图'),
    subtitle: scopeData(locale, 'Routes for the Electron workbench and its privileged host boundaries.', 'Electron 工作台及其特权宿主边界的阅读路径。'),
    scope: 'apps/canvas-workspace',
    metrics: [
      { value: String(countFiles('apps/canvas-workspace/harness/knowledge', (name) => name.endsWith('.md'))), label: scopeData(locale, 'knowledge documents', '知识文档') },
      { value: String(countFiles('apps/canvas-workspace/harness/skills', (name) => name === 'SKILL.md')), label: scopeData(locale, 'local action skills', '本地操作技能') },
      { value: String(countFiles('apps/canvas-workspace/src/main/__tests__', (name) => name.endsWith('.test.ts'))), label: scopeData(locale, 'main-process test files', '主进程测试文件') },
      { value: '4', label: scopeData(locale, 'process surfaces', '进程表面') },
    ],
    entryNodes: scopeData(locale,
      [{ title: 'AGENTS.md', detail: 'Root boundaries and validation routing.' }, { title: 'apps/canvas-workspace/AGENTS.md', detail: 'Electron app owner, knowledge, tools, and local checks.' }],
      [{ title: 'AGENTS.md', detail: '根级边界与校验路由。' }, { title: 'apps/canvas-workspace/AGENTS.md', detail: 'Electron 应用所有者、知识、工具与本地检查。' }]),
    branches: [
      branch('cross-process-boundary', locale,
        { label: 'Change a cross-process API', intent: ['Keep renderer privileges constrained', 'Preserve IPC and preload contracts'], sources: ['harness/knowledge/conventions/architecture-boundaries.md', 'src/preload/index.ts', 'src/shared/', 'src/main/__tests__/import-boundaries.test.ts'], reads: ['Renderer reaches privilege only through window.canvasWorkspace', 'Shared contracts stay runtime-neutral'], evidence: ['Run typecheck', 'Run import-boundary and app tests'], level: 4 },
        { label: '修改跨进程 API', intent: ['限制渲染进程权限', '保持 IPC 与 preload 契约'], sources: ['harness/knowledge/conventions/architecture-boundaries.md', 'src/preload/index.ts', 'src/shared/', 'src/main/__tests__/import-boundaries.test.ts'], reads: ['渲染进程只能经由 window.canvasWorkspace 获取特权能力', '共享契约保持运行时中立'], evidence: ['运行 typecheck', '运行导入边界与应用测试'], level: 4 }),
      branch('canvas-node-extension', locale,
        { label: 'Add a canvas node capability', intent: ['Choose plugin versus host node path', 'Keep node contracts synchronized'], sources: ['harness/skills/add-canvas-node/SKILL.md', 'harness/knowledge/plugin-node-mf2.md', 'src/shared/canvas.ts', 'src/renderer/src/utils/nodeFactory.ts'], reads: ['Plugin nodes are the default extension path', 'Host node types are reserved for deeper main-process integration'], evidence: ['Run node harness/tools/describe-canvas.mjs', 'Run typecheck and test'], level: 4 },
        { label: '新增 Canvas 节点能力', intent: ['选择插件或宿主节点路径', '保持节点契约同步'], sources: ['harness/skills/add-canvas-node/SKILL.md', 'harness/knowledge/plugin-node-mf2.md', 'src/shared/canvas.ts', 'src/renderer/src/utils/nodeFactory.ts'], reads: ['插件节点是默认扩展路径', '宿主节点类型仅用于更深的主进程集成'], evidence: ['运行 node harness/tools/describe-canvas.mjs', '运行 typecheck 与 test'], level: 4 }),
      branch('agent-tool-or-security-change', locale,
        { label: 'Change Agent tools or execution reach', intent: ['Assess privilege expansion', 'Treat web and disk input as untrusted'], sources: ['harness/knowledge/security-posture.md', 'src/main/agent/canvas-agent.ts', 'src/main/agent/tools/'], reads: ['Agent tools run with desktop-user main-process privileges', 'There is no human approval gate around tool calls'], evidence: ['Review security posture', 'Run focused tests; do not infer sandbox coverage'], level: 4 },
        { label: '修改 Agent 工具或执行范围', intent: ['评估权限扩大', '将网页和磁盘输入视为不可信'], sources: ['harness/knowledge/security-posture.md', 'src/main/agent/canvas-agent.ts', 'src/main/agent/tools/'], reads: ['Agent 工具以桌面用户主进程权限运行', '工具调用没有人工审批门'], evidence: ['审阅安全态势', '运行聚焦测试；不要推断存在沙箱保护'], level: 4 }),
    ],
  };
}

export function createScopeGraph(scope, locale = 'en') {
  if (!scopes.has(scope)) throw new Error(`Unknown scope: ${scope}. Use root, engine, or canvas-workspace.`);
  if (!['en', 'zh'].includes(locale)) throw new Error(`Unknown locale: ${locale}. Use en or zh.`);
  const graph = scope === 'root' ? rootGraph(locale) : scope === 'engine' ? engineGraph(locale) : canvasGraph(locale);
  return {
    ...graph,
    locale,
    evidenceLevels: scopeData(locale,
      [{ title: 'Entry', detail: 'Routing rules' }, { title: 'Knowledge', detail: 'Current constraints' }, { title: 'Source', detail: 'Implementation and contracts' }, { title: 'Checks', detail: 'Static, test, and runtime evidence' }],
      [{ title: '入口', detail: '路由规则' }, { title: '知识', detail: '当前约束' }, { title: '源码', detail: '实现与契约' }, { title: '检查', detail: '静态、测试与运行时证据' }]),
    boundary: scopeData(locale, 'This graph uses repository files only. It does not read secrets, user data, or claim unrun checks passed.', '此图仅使用仓库文件，不读取密钥或用户数据，也不会声称未运行的检查已通过。'),
  };
}

export function createAllScopeGraphs(locale = 'en') {
  return ['root', 'engine', 'canvas-workspace'].map((scope) => createScopeGraph(scope, locale));
}
