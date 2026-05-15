#!/usr/bin/env node
const { execFileSync, spawnSync } = require('node:child_process');
const { existsSync, mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const CONFIG = {
  baseToken: 'S0mobHFtVajhoVs3c3fcjFHyn1c',
  tableId: 'tblDpQly4EZDUZ1H',
  viewId: 'vewh1yRfP6',
  repo: 'hua-bang/pulse-agent',
  codeDir: '/root/pulse-coder/apps/canvas-workspace',
  defaultLimit: 5,
  maxRecordPageSize: 500,
  markerPrefix: 'pulse-canvas-feedback-issue-sync',
};

function parseBool(value, fallback = false) {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'y', 'on'].includes(String(value).toLowerCase());
}

function parsePositiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function parseArgs(argv) {
  const args = {
    dryRun: false,
    limit: CONFIG.defaultLimit,
    recordId: '',
    updateBase: true,
    as: 'user',
    json: true,
    includeClosed: true,
  };

  for (const arg of argv) {
    if (arg === '--dry-run' || arg === '--dryRun' || arg === 'dryRun=true' || arg === 'dry-run') {
      args.dryRun = true;
    } else if (arg === '--no-dry-run' || arg === 'dryRun=false') {
      args.dryRun = false;
    } else if (arg === '--no-update-base' || arg === 'updateBase=false') {
      args.updateBase = false;
    } else if (arg === '--update-base' || arg === 'updateBase=true') {
      args.updateBase = true;
    } else if (arg.startsWith('--limit=')) {
      args.limit = parsePositiveInt(arg.slice('--limit='.length), CONFIG.defaultLimit);
    } else if (arg.startsWith('limit=')) {
      args.limit = parsePositiveInt(arg.slice('limit='.length), CONFIG.defaultLimit);
    } else if (arg.startsWith('--record-id=')) {
      args.recordId = arg.slice('--record-id='.length).trim();
    } else if (arg.startsWith('recordId=')) {
      args.recordId = arg.slice('recordId='.length).trim();
    } else if (arg.startsWith('--as=')) {
      const identity = arg.slice('--as='.length).trim();
      args.as = identity === 'bot' ? 'bot' : 'user';
    } else if (arg.startsWith('--include-closed=')) {
      args.includeClosed = parseBool(arg.slice('--include-closed='.length), true);
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  return args;
}

function printHelp() {
  console.log(`Usage: pulse-canvas-feedback-issue-sync [options]\n\nOptions:\n  --dry-run                 Preview actions without creating issues/updating Base\n  --limit=N                 Max candidate records to process (default: ${CONFIG.defaultLimit})\n  --record-id=rec...        Process one specific Feishu Base record\n  --no-update-base          Create/reuse issue but do not write back Base\n  --as=user|bot             lark-cli identity (default: user)\n  --include-closed=false    Ignore closed issues during idempotency search\n`);
}

function runJson(command, args, options = {}) {
  const output = execFileSync(command, args, {
    cwd: options.cwd || process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 20 * 1024 * 1024,
  });
  return JSON.parse(output);
}

function runText(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd || process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 20 * 1024 * 1024,
  }).trim();
}

function runResult(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd || process.cwd(),
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
}

function getFields(as) {
  const result = runJson('lark-cli', [
    'base', '+field-list',
    '--base-token', CONFIG.baseToken,
    '--table-id', CONFIG.tableId,
    '--offset', '0',
    '--limit', '100',
    '--as', as,
  ]);
  if (!result.ok) {
    throw new Error(`field-list failed: ${JSON.stringify(result)}`);
  }
  return result.data.items;
}

function getRecords(as) {
  const allRecords = [];
  let offset = 0;

  while (true) {
    const result = runJson('lark-cli', [
      'base', '+record-list',
      '--base-token', CONFIG.baseToken,
      '--table-id', CONFIG.tableId,
      '--view-id', CONFIG.viewId,
      '--offset', String(offset),
      '--limit', String(CONFIG.maxRecordPageSize),
      '--as', as,
    ]);
    if (!result.ok) {
      throw new Error(`record-list failed: ${JSON.stringify(result)}`);
    }

    const data = result.data;
    const pageRecords = (data.record_id_list || []).map((recordId, index) => {
      const fields = {};
      (data.fields || []).forEach((name, fieldIndex) => {
        fields[name] = data.data[index][fieldIndex];
      });
      return { recordId, fields };
    });
    allRecords.push(...pageRecords);

    if (!data.has_more || pageRecords.length === 0) break;
    offset += pageRecords.length;
  }

  return allRecords;
}

function isIssueLinkEmpty(value) {
  if (value === null || value === undefined) return true;
  const text = Array.isArray(value) ? value.join(' ') : String(value);
  return !/https:\/\/github\.com\/hua-bang\/pulse-agent\/issues\/\d+/i.test(text);
}

function normalizeSelect(value) {
  if (Array.isArray(value)) return value.filter(Boolean).join(', ');
  return value ? String(value) : '';
}

function issueUrlFromField(value) {
  if (value === null || value === undefined) return '';
  const text = Array.isArray(value) ? value.join(' ') : String(value);
  const match = text.match(/https:\/\/github\.com\/hua-bang\/pulse-agent\/issues\/\d+/i);
  return match ? match[0] : '';
}

function issueUrlFromSearchItem(item) {
  return item && item.url ? item.url : '';
}

function findExistingIssue(recordId, includeClosed) {
  const query = `<!-- feishu_record_id: ${recordId} -->`;
  const args = [
    'search', 'issues',
    '--repo', CONFIG.repo,
    query,
    '--json', 'number,title,url,state',
    '--limit', '10',
  ];

  if (!includeClosed) {
    args.push('--state', 'open');
  }

  const result = runResult('gh', args);
  if (result.status !== 0) {
    throw new Error(`gh search failed: ${result.stderr || result.stdout}`.trim());
  }
  const items = JSON.parse(result.stdout || '[]');
  const exact = items.find((item) => item && item.url && (item.title || item.number));
  return issueUrlFromSearchItem(exact);
}

function buildIssueTitle(record) {
  const content = String(record.fields['反馈内容'] || '').trim();
  if (!content) return `Pulse Canvas feedback ${record.recordId}`;
  const normalized = content.replace(/\s+/g, ' ').slice(0, 60);
  return normalized || `Pulse Canvas feedback ${record.recordId}`;
}

function buildIssueBody(record) {
  const f = record.fields;
  const content = String(f['反馈内容'] || '').trim() || '(空)';
  const feedbackType = normalizeSelect(f['反馈类型']) || '(未填写)';
  const submittedAt = String(f['提交时间'] || '(未知)');
  const priority = normalizeSelect(f['优先级']) || '(视图未显示/未填写)';
  const attachments = Array.isArray(f['截图/录屏']) && f['截图/录屏'].length > 0
    ? f['截图/录屏'].map((item) => `- ${item.name || 'attachment'} (${item.file_token || 'no token'})`).join('\n')
    : '- 无';

  return `## 反馈内容\n\n${content}\n\n## 反馈类型\n\n${feedbackType}\n\n## 复现 / 现象线索\n\n- 来源：飞书多维表格「Pulse Canvas 天使用户反馈」\n- record_id: \`${record.recordId}\`\n- 提交时间：${submittedAt}\n- 优先级：${priority}\n- 截图/录屏：\n${attachments}\n\n## 代码初步分析\n\n当前 \`apps/canvas-workspace\` 是 Pulse Canvas 桌面端工作区，画布核心逻辑主要集中在：\n\n- \`src/renderer/src/components/Canvas/index.tsx\`：画布主交互、工具栏动作、节点创建入口。\n- \`src/renderer/src/components/Canvas/CanvasSurface.tsx\` 与 \`CanvasOverlays.tsx\`：画布渲染层、连线/框选/绘制 overlay。\n- \`src/renderer/src/components/FloatingToolbar/*\`：浮动工具栏和绘制工具入口。\n- \`src/renderer/src/components/CanvasNodeView/*\` 及各类 \`*NodeBody\`：节点展示与编辑能力。\n\n该反馈需要结合现有节点类型、工具栏入口、画布坐标/缩放、状态持久化与导入导出能力评估。\n\n## 建议处理方向\n\n1. 明确 MVP 边界，避免一次性做成完整白板产品。\n2. 优先复用现有 canvas 坐标系、选择系统、历史记录与持久化结构。\n3. 根据需求决定是新增节点类型、扩展 shape 工具，还是增加画布级 overlay/layer。\n4. 补充验收用例，覆盖缩放/平移/保存恢复/和现有节点交互的兼容性。\n\n## 验收标准\n\n- 需求入口在 Canvas 中可被发现并使用。\n- 新能力在保存/重开后能恢复。\n- 不破坏现有节点拖拽、框选、连线、删除、撤销/回退等核心交互。\n- 若涉及工具栏/快捷键，需有清晰状态反馈。\n\n## 风险点\n\n- overlay 事件与节点选择、拖拽、连线冲突。\n- 大量绘制/结构化数据带来的渲染性能和存储体积问题。\n- 历史记录、导入导出和旧 workspace schema 兼容性。\n\n<!-- feishu_record_id: ${record.recordId} -->\n<!-- feishu_base_token: ${CONFIG.baseToken} -->\n<!-- managed_by: ${CONFIG.markerPrefix} -->\n`;
}

function createIssue(record, dryRun) {
  const title = buildIssueTitle(record);
  const body = buildIssueBody(record);
  if (dryRun) {
    return { url: '', title, dryRun: true };
  }

  const dir = mkdtempSync(join(tmpdir(), 'pulse-canvas-feedback-'));
  const bodyPath = join(dir, 'issue.md');
  try {
    writeFileSync(bodyPath, body, 'utf8');
    const url = runText('gh', [
      'issue', 'create',
      '--repo', CONFIG.repo,
      '--title', title,
      '--body-file', bodyPath,
    ]);
    return { url, title, dryRun: false };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function updateBaseRecord(record, issueUrl, as, dryRun) {
  const now = new Date().toISOString();
  const previousRemark = record.fields['备注'] ? String(record.fields['备注']) : '';
  const remarkLine = `[${now}] ${CONFIG.markerPrefix}：已创建/复用 GitHub issue 并回填链接：${issueUrl}`;
  const remark = previousRemark ? `${previousRemark}\n${remarkLine}` : remarkLine;
  const payload = JSON.stringify({
    'issue 链接': issueUrl,
    '备注': remark,
  });

  if (dryRun) {
    return { updated: false, dryRun: true, payload: JSON.parse(payload) };
  }

  const result = runJson('lark-cli', [
    'base', '+record-upsert',
    '--base-token', CONFIG.baseToken,
    '--table-id', CONFIG.tableId,
    '--record-id', record.recordId,
    '--json', payload,
    '--as', as,
  ]);
  if (!result.ok) {
    throw new Error(`record-upsert failed: ${JSON.stringify(result)}`);
  }
  return { updated: Boolean(result.data && result.data.updated) };
}

function processRecord(record, args) {
  const existingUrl = findExistingIssue(record.recordId, args.includeClosed);
  const action = {
    recordId: record.recordId,
    feedback: String(record.fields['反馈内容'] || '').slice(0, 100),
    action: '',
    issueUrl: existingUrl,
    baseUpdated: false,
  };

  let issueUrl = existingUrl;
  if (issueUrl) {
    action.action = 'reuse_existing_issue';
  } else {
    const created = createIssue(record, args.dryRun);
    action.action = args.dryRun ? 'would_create_issue' : 'created_issue';
    action.issueTitle = created.title;
    issueUrl = created.url;
    action.issueUrl = issueUrl;
  }

  if (args.updateBase && issueUrl) {
    const update = updateBaseRecord(record, issueUrl, args.as, args.dryRun);
    action.baseUpdated = update.updated;
    if (args.dryRun) action.baseUpdatePayload = update.payload;
  } else if (args.updateBase && args.dryRun) {
    action.baseUpdated = false;
  }

  return action;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const summary = {
    ok: true,
    dryRun: args.dryRun,
    args,
    config: {
      baseToken: CONFIG.baseToken,
      tableId: CONFIG.tableId,
      viewId: CONFIG.viewId,
      repo: CONFIG.repo,
      codeDirExists: existsSync(CONFIG.codeDir),
    },
    scanned: 0,
    withExistingIssueLink: 0,
    candidates: 0,
    processed: 0,
    created: 0,
    wouldCreate: 0,
    reused: 0,
    baseUpdated: 0,
    skipped: 0,
    failed: 0,
    actions: [],
    failures: [],
  };

  try {
    getFields(args.as);
    const records = getRecords(args.as);
    summary.scanned = records.length;
    summary.withExistingIssueLink = records.filter((record) => !isIssueLinkEmpty(record.fields['issue 链接'])).length;

    const candidates = records
      .filter((record) => !args.recordId || record.recordId === args.recordId)
      .filter((record) => isIssueLinkEmpty(record.fields['issue 链接']))
      .slice(0, args.limit);
    summary.candidates = candidates.length;

    if (args.recordId && !records.some((record) => record.recordId === args.recordId)) {
      summary.failures.push({ recordId: args.recordId, error: 'recordId not found in configured view' });
      summary.failed += 1;
    }

    for (const record of candidates) {
      try {
        const action = processRecord(record, args);
        summary.actions.push(action);
        summary.processed += 1;
        if (action.action === 'created_issue') summary.created += 1;
        if (action.action === 'would_create_issue') summary.wouldCreate += 1;
        if (action.action === 'reuse_existing_issue') summary.reused += 1;
        if (action.baseUpdated) summary.baseUpdated += 1;
      } catch (error) {
        summary.failed += 1;
        summary.failures.push({
          recordId: record.recordId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    summary.skipped = Math.max(0, summary.scanned - summary.candidates);
  } catch (error) {
    summary.ok = false;
    summary.failed += 1;
    summary.failures.push({ error: error instanceof Error ? error.message : String(error) });
  }

  console.log(JSON.stringify(summary, null, 2));
  process.exit(summary.ok && summary.failed === 0 ? 0 : 1);
}

main();
