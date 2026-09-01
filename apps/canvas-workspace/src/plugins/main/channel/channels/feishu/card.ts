// Feishu interactive card (schema 2.0) builders for the streamed agent run.
// One card is created on run start and progressively patched: thinking →
// progress (accumulated text + a live list of tool calls) → done / error.
// On done the tool list folds into a collapsible panel so the answer stays
// front-and-center while the work remains inspectable.

import type { OutboundTarget, WorkspacePicker } from '../../core/types';

// Feishu rejects oversized card payloads; keep the streamed body bounded.
const MAX_CARD_TEXT = 8000;
export const WORKSPACE_PICKER_SELECT_NAME = 'workspace_picker_workspace';
export const WORKSPACE_PICKER_USE_BUTTON = 'workspace_use';
export const WORKSPACE_PICKER_CARRY_BUTTON = 'workspace_use_carry';

function clamp(text: string): string {
  if (text.length <= MAX_CARD_TEXT) return text;
  return `…${text.slice(text.length - MAX_CARD_TEXT)}`;
}

/** One tool call in the run's progress list. */
export interface ToolEntry {
  /** "name — detail" (no status icon; the renderer adds it). */
  label: string;
  /** True once the tool has returned a result. */
  done: boolean;
  /** Wall-clock duration in seconds, set when done. */
  elapsedSec?: number;
}

function md(content: string): object {
  return { tag: 'markdown', content };
}

function plainText(content: string): object {
  return { tag: 'plain_text', content };
}

function card(title: string, template: string, elements: object[], forward: boolean): object {
  return {
    schema: '2.0',
    config: { enable_forward: forward, wide_screen_mode: true },
    header: {
      template,
      title: plainText(title),
    },
    body: { elements },
  };
}

function formButton(
  name: string,
  text: string,
  target: OutboundTarget | undefined,
  carry: boolean,
  type: 'default' | 'primary' = 'default',
): object {
  const value = {
    action: 'workspace.use',
    carry,
    conversationId: target?.conversationId,
    reply: target?.reply,
  };
  return {
    tag: 'button',
    text: plainText(text),
    type,
    width: 'fill',
    form_action_type: 'submit',
    name,
    value,
    behaviors: [{ type: 'callback', value }],
  };
}

/** Render the tool calls as a status list (⏳ running · ✅ done with timing). */
function toolLines(tools: ToolEntry[]): string {
  return tools
    .map((t) => {
      const icon = t.done ? '✅' : '⏳';
      const { name, detail } = splitToolLabel(t.label);
      // Bold the tool name so each row reads as "what" then "on what",
      // keeping the detail (and timing) visually secondary.
      const segs = [`${icon} **${name || 'tool'}**`];
      if (detail) segs.push(detail);
      if (t.done && typeof t.elapsedSec === 'number') segs.push(`${t.elapsedSec}s`);
      return segs.join(' · ');
    })
    .join('\n');
}

/** Recover the "name" / "detail" parts of a `formatToolLabel` string. */
function splitToolLabel(label: string): { name: string; detail: string } {
  const i = label.indexOf(' — ');
  if (i >= 0) return { name: label.slice(0, i), detail: label.slice(i + 3) };
  return { name: label, detail: '' };
}

function processSummary(status: string, toolCount: number, elapsedSec?: number): string {
  const parts = [status, `调用 ${toolCount} 次`];
  if (typeof elapsedSec === 'number') parts.push(`${elapsedSec}s`);
  return parts.join(' · ');
}

function currentStepLine(tool?: ToolEntry): string | undefined {
  if (!tool) return undefined;
  const { name, detail } = splitToolLabel(tool.label);
  const icon = tool.done ? '✅' : '⏳';
  return `**当前步骤**\n${icon} ${name || 'tool'}${detail ? ` · ${detail}` : ''}`;
}

/** Native-like Agent process block: one compact row when collapsed, details on demand. */
function processPanel(input: {
  status: string;
  tools?: ToolEntry[];
  elapsedSec?: number;
  currentAnswer?: string;
  note?: string;
}): object {
  const tools = input.tools ?? [];
  const detailSections = [
    input.note,
    currentStepLine(tools.at(-1)),
    input.currentAnswer?.trim() ? `**当前答复**\n${clamp(input.currentAnswer.trim())}` : undefined,
    tools.length > 0 ? `**执行步骤**\n${toolLines(tools)}` : undefined,
  ].filter((section): section is string => Boolean(section));

  return {
    tag: 'collapsible_panel',
    expanded: false,
    header: {
      title: md(`执行过程 · ${processSummary(input.status, tools.length, input.elapsedSec)}`),
      vertical_align: 'center',
    },
    elements: [md(detailSections.join('\n\n') || '正在初始化运行环境...')],
  };
}

export function buildThinkingCard(): object {
  return card('Pulse 执行过程', 'blue', [processPanel({
    status: '准备中',
    note: '已收到请求，正在准备运行环境...',
  })], false);
}

export function buildProgressCard(
  text: string,
  tools: ToolEntry[] = [],
  elapsedSec?: number,
): object {
  return card('Pulse 执行过程', 'blue', [processPanel({
    status: '运行中',
    tools,
    elapsedSec,
    currentAnswer: text,
    note: tools.length === 0 ? '正在生成答复...' : undefined,
  })], false);
}

export function buildCompletedProcessCard(tools: ToolEntry[] = [], elapsedSec?: number): object {
  return card('Pulse · Completed', 'green', [processPanel({
    status: '已完成',
    tools,
    elapsedSec,
    note: `已完成 ${tools.length} 个步骤，最终答复见下一条消息。`,
  })], true);
}

export function buildFinalAnswerCard(text: string): object {
  return card('Pulse 最终答复', 'green', [md(clamp(text) || '✅ Done')], true);
}

export function buildDoneCard(text: string, tools: ToolEntry[] = []): object {
  const elements: object[] = [md(clamp(text) || '✅ Done')];
  if (tools.length > 0) {
    elements.push(processPanel({
      status: '已完成',
      tools,
      note: `已完成 ${tools.length} 个步骤。`,
    }));
  }
  return card('Pulse 已完成', 'green', elements, true);
}

export function buildErrorCard(message: string): object {
  return card('Pulse 运行出错', 'red', [md(`**状态**：出错\n\n❌ ${message}`)], false);
}

export function buildWorkspacePickerCard(picker: WorkspacePicker, target?: OutboundTarget): object {
  const rows = picker.options.slice(0, 10);
  const options = rows.map((workspace) => {
    const marks = [
      workspace.isBound ? '⭐' : null,
      workspace.isActive ? '🖥️' : null,
    ].filter(Boolean).join(' ');
    const label = marks ? `${workspace.label} ${marks}` : workspace.label;
    return {
      text: plainText(label),
      value: workspace.id,
    };
  });
  const initial = rows.find((w) => w.isBound)?.id ?? rows.find((w) => w.isActive)?.id ?? rows[0]?.id;
  const primaryCarry = picker.defaultCarry;
  const primaryButton = primaryCarry
    ? formButton(WORKSPACE_PICKER_CARRY_BUTTON, '带上刚才讨论', target, true, 'primary')
    : formButton(WORKSPACE_PICKER_USE_BUTTON, '使用', target, false, 'primary');
  const secondaryButton = primaryCarry
    ? formButton(WORKSPACE_PICKER_USE_BUTTON, '不带讨论', target, false)
    : formButton(WORKSPACE_PICKER_CARRY_BUTTON, '带上刚才讨论', target, true);

  return {
    schema: '2.0',
    config: { enable_forward: false, wide_screen_mode: true },
    header: {
      template: 'blue',
      title: plainText(picker.title),
    },
    body: {
      elements: [
        md(picker.summary),
        {
          tag: 'form',
          name: 'workspace_picker_form',
          elements: [
            {
              tag: 'select_static',
              name: WORKSPACE_PICKER_SELECT_NAME,
              required: true,
              type: 'default',
              width: 'fill',
              placeholder: plainText('选择工作区'),
              ...(initial ? { initial_option: initial } : {}),
              options,
            },
            {
              tag: 'column_set',
              flex_mode: 'bisect',
              horizontal_spacing: '8px',
              columns: [
                {
                  tag: 'column',
                  width: 'weighted',
                  weight: 1,
                  elements: [primaryButton],
                },
                {
                  tag: 'column',
                  width: 'weighted',
                  weight: 1,
                  elements: [secondaryButton],
                },
              ],
            },
          ],
        },
        md('也可以发送 `/use <工作区名>`，需要带上刚才讨论时加 `--carry`。'),
      ],
    },
  };
}

/** A short, human-readable label for a tool call: "name — detail". */
export function formatToolLabel(name: string, args: unknown): string {
  const detail = summarizeArgs(args);
  return detail ? `${name} — ${detail}` : name;
}

function summarizeArgs(args: unknown): string {
  if (!args || typeof args !== 'object') return '';
  const record = args as Record<string, unknown>;
  // Prefer a few common, meaningful fields for a compact hint. Ordered most-
  // to least descriptive so e.g. a title wins over a bare id.
  for (const key of [
    'title', 'name', 'query', 'q', 'prompt', 'question',
    'path', 'file', 'filePath', 'fileName', 'fileToken',
    'url', 'link', 'href', 'docToken', 'documentId', 'document', 'doc', 'token',
    'selector', 'key', 'pattern', 'command', 'cmd', 'text', 'nodeId', 'id',
  ]) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return shorten(prettyValue(key, value.trim()));
    }
  }
  return '';
}

/** Make a raw arg value compact and readable for the card (basename, host/…/slug). */
function prettyValue(key: string, value: string): string {
  if (key === 'url' || key === 'link' || key === 'href') {
    try {
      const u = new URL(value);
      const slug = u.pathname.split('/').filter(Boolean).pop();
      return slug ? `${u.hostname}/…/${slug}` : u.hostname;
    } catch {
      /* not a URL — fall through to the raw value */
    }
  }
  if (key === 'path' || key === 'file' || key === 'filePath') {
    const base = value.split(/[\\/]/).filter(Boolean).pop();
    if (base) return base;
  }
  return value;
}

function shorten(value: string): string {
  return value.length > 48 ? `${value.slice(0, 48)}…` : value;
}
