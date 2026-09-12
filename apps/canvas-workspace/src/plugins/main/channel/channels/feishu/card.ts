// Feishu schema 2.0 builders: a streamed process card and a separate reply card.

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
  /** Public assistant commentary emitted before this tool. */
  beforeText?: string;
  /** True once the tool has returned a result. */
  done: boolean;
  /** Wall-clock duration in seconds, set when done. */
  elapsedSec?: number;
}

function md(content: string, textSize?: 'heading' | 'normal' | 'notation', id?: string): object {
  return { tag: 'markdown', content, ...(textSize ? { text_size: textSize } : {}), ...(id ? { element_id: id } : {}) };
}

function muted(content: string): string {
  return `<font color="grey">${content}</font>`;
}

function red(content: string): string {
  return `<font color="red">${content}</font>`;
}

function plainText(content: string): object {
  return { tag: 'plain_text', content };
}

function card(title: string | undefined, template: string, elements: object[], forward: boolean): object {
  return {
    schema: '2.0',
    config: { enable_forward: forward, wide_screen_mode: true },
    ...(title
      ? {
          header: {
            template,
            title: plainText(title),
          },
        }
      : {}),
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

function toolLine(tool: ToolEntry): string {
  const { name, detail } = splitToolLabel(tool.label);
  const segs = [titleizeToolName(name || 'tool')];
  if (detail) segs.push(detail.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'));
  if (tool.done && typeof tool.elapsedSec === 'number') segs.push(`${tool.elapsedSec}s`);
  return segs.join(' · ');
}

/** Keep pending feedback readable without changing glyph size on every patch. */
function pendingLabel(elapsedSec: number): string {
  const seconds = Number.isFinite(elapsedSec) ? Math.max(0, Math.floor(elapsedSec)) : 0;
  if (seconds < 5) return '正在处理';
  const duration = seconds < 60
    ? `${seconds} 秒`
    : `${Math.floor(seconds / 60)} 分 ${String(seconds % 60).padStart(2, '0')} 秒`;
  return `正在处理 · 已等待 ${duration}`;
}

/** Finished rows recede; active rows use a stable, explicit status label. */
function toolTimeline(tools: ToolEntry[], elapsedSec: number, running: boolean, text = '', stopped = false): string {
  const rail = muted('│');
  const rows = tools.map((tool) => {
    const completed = tool.done || !running;
    const label = completed ? muted(toolLine(tool)) : `${toolLine(tool)}  ${muted('执行中')}`;
    return [tool.beforeText?.trim(), `${rail}  ${muted('›')}  ${label}`].filter(Boolean).join('\n\n');
  });

  if (text.trim()) rows.push(text.trim());
  if (running && rows.length === 0) {
    rows.push(muted(pendingLabel(elapsedSec)));
  } else if (!running) {
    rows.push(`${muted('└')}  ${muted(stopped ? '◎ Stopped' : '◎ Completed')}`);
  }
  return rows.join('\n');
}

/** Recover the "name" / "detail" parts of a `formatToolLabel` string. */
function splitToolLabel(label: string): { name: string; detail: string } {
  const i = label.indexOf(' — ');
  if (i >= 0) return { name: label.slice(0, i), detail: label.slice(i + 3) };
  return { name: label, detail: '' };
}

function titleizeToolName(name: string): string {
  const words = name.replace(/[_-]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 'Tool';
  return words.map((word, index) => (
    index === 0 ? `${word.charAt(0).toUpperCase()}${word.slice(1)}` : word
  )).join(' ');
}

function statusLine(status: 'working' | 'thinking' | 'completed' | 'stopped'): string {
  return `**${{ working: 'Working', thinking: 'Thinking', completed: 'Completed', stopped: 'Stopped' }[status]}**`;
}

/** Working/Completed is itself the disclosure control, like the reference. */
function processPanel(
  status: 'working' | 'completed' | 'stopped',
  tools: ToolEntry[],
  elapsedSec: number,
  text = '',
): object {
  return {
    tag: 'collapsible_panel',
    expanded: true,
    header: {
      title: md(statusLine(status === 'working' && (text.trim() || tools.length > 0) && tools.every(tool => tool.done)
        ? 'thinking' : status), 'normal', 'process_status'),
      vertical_align: 'center',
    },
    elements: [md(clamp(toolTimeline(tools, elapsedSec, status === 'working', text, status === 'stopped')), 'notation', 'process_body')],
  };
}

/** Streamed text is public progress; final output has its own message. */
export function buildThinkingCard(): object {
  return buildProgressCard('');
}

export function buildProgressCard(text: string, tools: ToolEntry[] = [], elapsedSec = 0): object {
  return card(undefined, 'blue', [processPanel('working', tools, elapsedSec, text)], false);
}

export function buildDoneCard(text: string, tools: ToolEntry[] = [], stopped = false): object {
  return card(undefined, 'grey', [processPanel(stopped ? 'stopped' : 'completed', tools, 0, text)], true);
}

export function buildReplyCard(
  text: string,
  state: 'queued' | 'working' | 'stopping' | 'completed' | 'stopped' | 'error',
  stopToken?: string,
): object {
  const active = ['queued', 'working', 'stopping'].includes(state);
  const hint = state === 'queued' ? '正在等待执行…'
    : state === 'stopping' ? '正在停止…' : '正在执行任务…';
  const elements = [md(active ? muted(`*${hint}*`) : clamp(text.trim() || '已完成'), 'normal')];
  if (active && stopToken) {
    const value = { action: 'run.stop', token: stopToken };
    elements.push({ tag: 'button', text: plainText('停止'), type: 'danger',
      disabled: state !== 'working', value, behaviors: [{ type: 'callback', value }] });
  }
  return card(undefined, 'grey', elements, !active);
}

export function buildErrorCard(message: string): object {
  return card(undefined, 'red', [
    md(`${red('●')} **Error**`, 'heading'),
    md(message, 'normal'),
  ], false);
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

/** Display only known descriptive string fields while tool JSON is incomplete. */
export function formatStreamingToolLabel(name: string, input: string): string | undefined {
  const match = input.match(/"(title|name|query|q|path|file|filePath|url|command|cmd)"\s*:\s*"((?:\\.|[^"\\])*)/);
  if (!match) return undefined;
  try {
    const value: unknown = JSON.parse(`"${match[2]}"`);
    if (typeof value !== 'string' || !value.trim()) return undefined;
    return formatToolLabel(name, { [match[1]]: value });
  } catch {
    // A chunk may end midway through a JSON unicode escape. Keep the previous
    // preview until the next chunk completes it.
    return undefined;
  }
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
