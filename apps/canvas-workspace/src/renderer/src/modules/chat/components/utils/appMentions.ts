import type { McpAppEntrypointListing } from '../../../../../../shared/mcp-apps';
import { decodeMentionPart, encodeMentionPart } from './mentionMarkers';
import { mentionIconSvg } from './mentionIcons';

export const APP_MENTION_PREFIX = 'app:';

export function parseAppMention(raw: string): { serverName: string; toolName: string; title: string } | null {
  if (!raw.startsWith(APP_MENTION_PREFIX)) return null;
  const parts = raw.slice(APP_MENTION_PREFIX.length).split('|');
  if (parts.length !== 3 || parts.some(part => !part)) return null;
  const [serverName, toolName, title] = parts.map(decodeMentionPart);
  return { serverName, toolName, title };
}

export function buildAppMentionChip(app: Pick<McpAppEntrypointListing, 'serverName' | 'toolName' | 'title'>): HTMLSpanElement {
  const chip = document.createElement('span');
  chip.className = 'chat-mention-chip chat-mention-chip--input chat-mention-chip--plugin';
  chip.contentEditable = 'false';
  chip.dataset.mention = APP_MENTION_PREFIX + [app.serverName, app.toolName, app.title].map(encodeMentionPart).join('|');
  chip.dataset.mentionKind = 'app';
  chip.dataset.nodeType = 'app';
  chip.title = `${app.serverName} · ${app.toolName}`;
  const icon = document.createElement('span');
  icon.className = 'chat-mention-chip-icon';
  icon.innerHTML = `<svg width="12" height="12" viewBox="0 0 14 14" fill="none">${mentionIconSvg('plugin')}</svg>`;
  const label = document.createElement('span');
  label.className = 'chat-mention-chip-label';
  label.textContent = app.title;
  chip.append(icon, label);
  return chip;
}

export function renderAppMentionHtml(raw: string): string {
  const app = parseAppMention(raw);
  if (!app) return '';
  const chip = buildAppMentionChip(app);
  chip.classList.remove('chat-mention-chip--input');
  chip.removeAttribute('contenteditable');
  return chip.outerHTML;
}
