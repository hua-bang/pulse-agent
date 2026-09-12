// Feishu interactive card (schema 2.0) builders for the streamed agent run.
// One card is created on run start and progressively patched: thinking →
// progress (accumulated text + a live list of tool calls) → done / error.
// Working/Completed is an expanded disclosure containing the live tool timeline;
// the same card keeps the streamed answer directly below it.

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

function md(content: string, textSize?: 'heading' | 'normal' | 'notation'): object {
  return { tag: 'markdown', content, ...(textSize ? { text_size: textSize } : {}) };
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
  if (detail) segs.push(detail);
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
function toolTimeline(tools: ToolEntry[], elapsedSec: number, running: boolean): string {
  const rail = muted('│');
  const rows = tools.map((tool) => {
    const completed = tool.done || !running;
    const label = completed ? muted(toolLine(tool)) : `${toolLine(tool)}  ${muted('执行中')}`;
    return `${rail}  ${muted('›')}  ${label}`;
  });

  if (running && rows.length === 0) {
    rows.push(muted(pendingLabel(elapsedSec)));
  } else if (!running) {
    rows.push(`${muted('└')}  ${muted('◎ Completed')}`);
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

function statusLine(status: 'working' | 'completed'): string {
  return `**${status === 'working' ? 'Working' : 'Completed'}**`;
}

/** Working/Completed is itself the disclosure control, like the reference. */
function processPanel(
  status: 'working' | 'completed',
  tools: ToolEntry[],
  elapsedSec: number,
): object {
  return {
    tag: 'collapsible_panel',
    expanded: true,
    header: {
      title: md(statusLine(status), 'normal'),
      vertical_align: 'center',
    },
    elements: [md(toolTimeline(tools, elapsedSec, status === 'working'), 'notation')],
  };
}

/** The process stays above the answer while both update in the same card. */
function liveElements(text: string, tools: ToolEntry[], elapsedSec: number): object[] {
  const elements: object[] = [processPanel('working', tools, elapsedSec)];
  if (text.trim()) elements.push(md(clamp(text.trim()), 'normal'));
  return elements;
}

export function buildThinkingCard(): object {
  return card(undefined, 'blue', liveElements('', [], 0), false);
}

export function buildProgressCard(
  text: string,
  tools: ToolEntry[] = [],
  elapsedSec = 0,
): object {
  return card(undefined, 'blue', liveElements(text, tools, elapsedSec), false);
}

export function buildDoneCard(text: string, tools: ToolEntry[] = []): object {
  const elapsedSec = tools.reduce((total, tool) => total + (tool.elapsedSec ?? 0), 0);
  const elements: object[] = tools.length > 0
    ? [processPanel('completed', tools, elapsedSec)]
    : [md(statusLine('completed'), 'normal')];
  if (text.trim()) elements.push(md(clamp(text.trim()), 'normal'));
  else elements.push(md(' Done', 'normal'));
  return card(undefined, 'green', elements, true);
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
