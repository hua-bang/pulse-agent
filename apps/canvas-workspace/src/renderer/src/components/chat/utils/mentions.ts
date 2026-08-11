import type { CanvasNode } from '../../../types';
import { CANVAS_MENTION_PREFIX, DOM_MENTION_PREFIX, FOLDER_MENTION_PREFIX, ROLE_MENTION_PREFIX, SESSION_MENTION_PREFIX, SKILL_MENTION_PREFIX, TAB_MENTION_PREFIX, TAG_MENTION_PREFIX } from '../constants';
import type { MentionItem, WorkspaceOption } from '../types';
import { renderMarkdown, type RenderMarkdownOptions } from './markdown';
import { MentionNodeIcon, mentionIconSvg } from './mentionIcons';
import { MENTION_RE, encodeMentionPart, pipedMentionLabel, protectMentionMarkers, restoreMentionMarkersInAttributes, restoreMentionMarkersInText, transformHtmlText } from './mentionMarkers';
import { writeDomSelectionDataset } from './domMentionData';
import { roleColorSoft } from './roleColors';
import { sessionTitleText } from './sessionTitle';
import {
  buildTabMentionChip,
  renderTabMentionHtml,
  tabMentionIconType,
} from './tabMentions';

// Re-exported so existing importers keep resolving from './mentions'.
export {
  buildTabMentionItems,
  collectTabRefsFromEditable,
  parseTabMention,
  tabMentionIconType,
  withCollectedTabs,
} from './tabMentions';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Inline override of the `--role-accent*` tokens for one role chip, so the
 * existing `.chat-mention-chip--role` rules (chip + child icon) resolve that
 * role's accent instead of the violet defaults. `roleColorSoft` doubles as
 * the `#rrggbb` validity gate: anything else returns '' and the chip keeps
 * the class fallback, and only validated values ever reach the style attr.
 */
function roleAccentStyleAttr(color: string | undefined): string {
  const soft = roleColorSoft(color, 0.18);
  if (!soft) return '';
  return ` style="--role-accent:${color};--role-accent-icon:${color};--role-accent-soft:${soft}"`;
}

const roleChipHtml = (name: string, color: string | undefined): string =>
  `<span class="chat-mention-chip chat-mention-chip--role" data-node-type="role"${roleAccentStyleAttr(color)}>`
  + `<span class="chat-mention-chip-icon"><svg width="12" height="12" viewBox="0 0 14 14" fill="none">${mentionIconSvg('role')}</svg></span>`
  + `<span class="chat-mention-chip-label">${escapeHtml(name)}</span></span>`;

/**
 * Chip the plain-text `@RoleName` an AGENT writes when handing off — models
 * never emit the internal `@[role:id|name]` marker, so without this the same
 * mention looks styled from the composer and bare from a role's reply.
 *
 * Applies only to assistant HTML: a plain `@name` a USER types does NOT route
 * to that role (routing needs the marker), so chipping it there would promise
 * something that did not happen.
 *
 * Rewrites text between tags only — never inside a tag or a code/pre block —
 * and requires a non-word char before the `@` so `a@b.com` is left alone.
 * Longest name wins and its span is consumed.
 */
export function renderRoleNameMentions(html: string, roleNames: ReadonlyMap<string, string>): string {
  if (roleNames.size === 0 || !html.includes('@')) return html;
  const names = [...roleNames.keys()].sort((a, b) => b.length - a.length);
  const parts = html.split(/(<[^>]*>)/);
  let codeDepth = 0;

  for (let index = 0; index < parts.length; index++) {
    const part = parts[index];
    if (part.startsWith('<')) {
      const tag = /^<(\/?)(code|pre)\b/i.exec(part);
      if (tag) codeDepth = Math.max(0, codeDepth + (tag[1] ? -1 : 1));
      continue;
    }
    if (codeDepth > 0 || !part.includes('@')) continue;

    let out = '';
    let cursor = 0;
    while (cursor < part.length) {
      const at = part.indexOf('@', cursor);
      if (at < 0) { out += part.slice(cursor); break; }
      out += part.slice(cursor, at);
      const prev = at > 0 ? part[at - 1] : '';
      const rest = part.slice(at + 1);
      const name = /[\w]/.test(prev) ? undefined : names.find(entry => rest.startsWith(escapeHtml(entry)));
      if (!name) { out += '@'; cursor = at + 1; continue; }
      out += roleChipHtml(name, roleNames.get(name));
      cursor = at + 1 + escapeHtml(name).length;
    }
    parts[index] = out;
  }

  return parts.join('');
}

function resolveMentionFilePath(rootFolder: string | undefined, relativePath: string): string {
  const root = rootFolder?.trim().replace(/[\\/]+$/, '') ?? '';
  const relative = relativePath.trim().replace(/^[\\/]+/, '').replace(/[\\/]+$/, '');
  return root && relative ? `${root}/${relative}` : '';
}

export interface SessionMentionRef {
  workspaceId: string;
  sessionId: string;
  messageIndex?: number;
  label: string;
}

/**
 * Parse an assistant-emitted session citation:
 * `session:<workspaceId>:<sessionId>:<messageIndex?>|<label>`
 * (the leading `@[` / trailing `]` are already stripped by MENTION_RE).
 * Returns null when the marker is malformed.
 */
export function parseSessionMention(rawLabel: string): SessionMentionRef | null {
  const body = rawLabel.slice(SESSION_MENTION_PREFIX.length);
  const pipeIndex = body.indexOf('|');
  const refPart = pipeIndex >= 0 ? body.slice(0, pipeIndex) : body;
  const labelPart = pipeIndex >= 0 ? body.slice(pipeIndex + 1).trim() : '';

  const segments = refPart.split(':');
  if (segments.length < 2) return null;
  const [workspaceId, sessionId, rawIndex] = segments;
  if (!workspaceId || !sessionId) return null;

  const parsedIndex = rawIndex !== undefined && rawIndex !== '' ? Number(rawIndex) : undefined;
  const messageIndex = parsedIndex !== undefined && Number.isInteger(parsedIndex) && parsedIndex >= 0
    ? parsedIndex
    : undefined;

  return {
    workspaceId,
    sessionId,
    messageIndex,
    label: labelPart || sessionId,
  };
}

// Icon helpers moved to ./mentionIcons (keeps this file under the 500-line
// governance gate); re-exported so existing importers are unaffected.
export { MentionNodeIcon, mentionIconSvg };

export function getMentionNodeType(item: MentionItem, nodes?: CanvasNode[]): string {
  if (item.type === 'skill') return 'skill';
  if (item.type === 'workspace') return 'workspace';
  if (item.type === 'folder') return 'folder';
  if (item.type === 'node') return item.nodeType ?? 'file';
  if (item.type === 'dom') return 'dom';
  if (item.type === 'tab') return tabMentionIconType(item.tab?.kind);

  return nodes?.find(node => node.title === item.label)?.type ?? item.nodeType ?? 'file';
}

export function extractMentionedWorkspaceIds(
  text: string,
  allWorkspaces: WorkspaceOption[] | undefined,
  currentWorkspaceId: string,
): string[] {
  if (!allWorkspaces || allWorkspaces.length === 0) return [];

  const re = new RegExp(`@\\[${CANVAS_MENTION_PREFIX}([^\\]]+)\\]`, 'g');
  const ids = new Set<string>();
  let match: RegExpExecArray | null;

  while ((match = re.exec(text)) !== null) {
    const workspaceName = match[1];
    const workspace = allWorkspaces.find(item => item.name === workspaceName);
    if (workspace && workspace.id !== currentWorkspaceId) {
      ids.add(workspace.id);
    }
  }

  return Array.from(ids);
}

// serializeEditable lives in its own module (keeps this file under the
// 500-line governance gate); re-exported here so existing importers are
// unaffected.
export { serializeEditable } from './serializeEditable';

export function createMentionChipElement(item: MentionItem, nodes?: CanvasNode[]): HTMLSpanElement {
  const isWorkspace = item.type === 'workspace';
  const isSkill = item.type === 'skill';
  const isFolder = item.type === 'folder';
  const isFile = item.type === 'file';
  const isNode = item.type === 'node';
  const isTag = item.type === 'tag';
  const isSession = item.type === 'session';
  const isDom = item.type === 'dom';
  const nodeType = getMentionNodeType(item, nodes);
  const chip = document.createElement('span');

  // Session mentions serialize to the same `@[session:...]` marker the
  // assistant emits when citing sessions, so the agent reads them uniformly
  // and the sent message renders them as clickable jump chips.
  if (isSession && item.sessionId && item.workspaceId) {
    const idx = typeof item.messageIndex === 'number' && item.messageIndex >= 0 ? String(item.messageIndex) : '';
    const sessionLabel = sessionTitleText(item.label);
    chip.className = 'chat-mention-chip chat-mention-chip--input chat-mention-chip--session';
    chip.contentEditable = 'false';
    chip.dataset.mention = `${SESSION_MENTION_PREFIX}${item.workspaceId}:${item.sessionId}:${idx}|${sessionLabel}`;
    chip.dataset.nodeType = 'session';

    const iconSpan = document.createElement('span');
    iconSpan.className = 'chat-mention-chip-icon';
    iconSpan.innerHTML = `<svg width="12" height="12" viewBox="0 0 14 14" fill="none">${mentionIconSvg('session')}</svg>`;
    chip.appendChild(iconSpan);

    const labelSpan = document.createElement('span');
    labelSpan.className = 'chat-mention-chip-label';
    labelSpan.textContent = sessionLabel;
    chip.appendChild(labelSpan);
    return chip;
  }

  // Right-dock tab mentions carry the full tab ref in data-* so the composer
  // can collect it at send time; the builder lives in ./tabMentions.
  if (item.type === 'tab' && item.tab) return buildTabMentionChip(item, nodeType);

  // Role mentions serialize to `@[role:<id>|<name>]` — the marker the main
  // process parses to pick the turn's speaking persona.
  if (item.type === 'role' && item.roleId) {
    chip.className = 'chat-mention-chip chat-mention-chip--input chat-mention-chip--role';
    chip.contentEditable = 'false';
    chip.dataset.mention = `${ROLE_MENTION_PREFIX}${item.roleId}|${item.label}`;
    chip.dataset.nodeType = 'role';

    const soft = roleColorSoft(item.roleColor, 0.18);
    if (item.roleColor && soft) {
      chip.style.setProperty('--role-accent', item.roleColor);
      chip.style.setProperty('--role-accent-icon', item.roleColor);
      chip.style.setProperty('--role-accent-soft', soft);
    }

    const iconSpan = document.createElement('span');
    iconSpan.className = 'chat-mention-chip-icon';
    iconSpan.innerHTML = `<svg width="12" height="12" viewBox="0 0 14 14" fill="none">${mentionIconSvg('role')}</svg>`;
    chip.appendChild(iconSpan);

    const labelSpan = document.createElement('span');
    labelSpan.className = 'chat-mention-chip-label';
    labelSpan.textContent = item.label;
    chip.appendChild(labelSpan);
    return chip;
  }

  // Canvas-node mentions focus the node; file/folder mentions open their
  // project path in VS Code when clicked.
  const isNavigable = (isNode && !!item.nodeId) || ((isFile || isFolder) && !!item.path);

  const classes = ['chat-mention-chip', 'chat-mention-chip--input'];
  if (isWorkspace) classes.push('chat-mention-chip--workspace');
  if (isSkill) classes.push('chat-mention-chip--skill');
  if (isFolder) classes.push('chat-mention-chip--folder');
  if (isTag) classes.push('chat-mention-chip--tag');
  if (isDom) classes.push('chat-mention-chip--dom');
  if (isNavigable) classes.push('chat-mention-chip--clickable');
  chip.className = classes.join(' ');
  chip.contentEditable = 'false';
  chip.dataset.mention = isWorkspace
    ? `${CANVAS_MENTION_PREFIX}${item.label}`
    : isSkill
      ? `${SKILL_MENTION_PREFIX}${item.label}`
      : isFolder
        ? `${FOLDER_MENTION_PREFIX}${item.label.replace(/\/$/, '')}`
        : isTag
          ? `${TAG_MENTION_PREFIX}${item.label}`
          : isDom
            ? `${DOM_MENTION_PREFIX}${item.domSelection?.id ?? item.label}|${encodeMentionPart(item.label)}`
            : item.label;
  chip.dataset.nodeType = nodeType;

  // data-mention-kind + ids let the composer collect structured, workspace-aware
  // context from the inline chips at send time (used by the global assistant).
  if (isWorkspace) {
    chip.dataset.mentionKind = 'canvas';
    if (item.workspaceId) chip.dataset.workspaceId = item.workspaceId;
  } else if (isTag) {
    chip.dataset.mentionKind = 'tag';
    chip.dataset.tag = item.label;
    if (item.workspaceIds && item.workspaceIds.length > 0) {
      chip.dataset.workspaceIds = item.workspaceIds.join(',');
    }
  } else if (isNode) {
    chip.dataset.mentionKind = 'node';
    if (item.nodeId) chip.dataset.nodeId = item.nodeId;
    if (item.workspaceId) chip.dataset.workspaceId = item.workspaceId;
  } else if ((isFile || isFolder) && item.path) {
    chip.dataset.filePath = item.path;
    chip.title = 'Open in VS Code';
  } else if (isDom && item.domSelection) {
    writeDomSelectionDataset(chip, item.domSelection);
  }

  if (!isSkill) {
    const iconSpan = document.createElement('span');
    iconSpan.className = 'chat-mention-chip-icon';
    iconSpan.innerHTML = isTag
      ? '<span class="chat-mention-chip-hash">#</span>'
      : `<svg width="12" height="12" viewBox="0 0 14 14" fill="none">${mentionIconSvg(nodeType)}</svg>`;
    chip.appendChild(iconSpan);
  }

  const labelSpan = document.createElement('span');
  labelSpan.className = 'chat-mention-chip-label';
  labelSpan.textContent = item.label;
  chip.appendChild(labelSpan);

  return chip;
}

// collectContextRefsFromEditable moved to ./contextRefs (500-line gate);
// re-exported so existing importers are unaffected.
export { collectContextRefsFromEditable } from './contextRefs';

export function renderMdWithMentions(
  content: string,
  nodes?: CanvasNode[],
  options?: RenderMarkdownOptions & {
    rootFolder?: string;
    /** Role id → accent color (see useRoleColors); missing ids keep the violet fallback. */
    roleColors?: ReadonlyMap<string, string>;
    /** Role name → accent color; set for ASSISTANT content only (see renderRoleNameMentions). */
    roleNames?: ReadonlyMap<string, string>;
  },
): string {
  const protectedMentions = protectMentionMarkers(content);
  const html = restoreMentionMarkersInText(
    renderMarkdown(protectedMentions.content, options),
    protectedMentions.markers,
  );

  const withMarkers = transformHtmlText(html, text => text.replace(MENTION_RE, (_match, rawLabel: string) => {
    if (rawLabel.startsWith(CANVAS_MENTION_PREFIX)) {
      const workspaceLabel = rawLabel.slice(CANVAS_MENTION_PREFIX.length);
      return `<span class="chat-mention-chip chat-mention-chip--workspace" data-node-type="workspace"><span class="chat-mention-chip-icon"><svg width="12" height="12" viewBox="0 0 14 14" fill="none">${mentionIconSvg('workspace')}</svg></span><span class="chat-mention-chip-label">${escapeHtml(workspaceLabel)}</span></span>`;
    }

    if (rawLabel.startsWith(SKILL_MENTION_PREFIX)) {
      const skillLabel = rawLabel.slice(SKILL_MENTION_PREFIX.length);
      return `<span class="chat-mention-chip chat-mention-chip--skill" data-node-type="skill"><span class="chat-mention-chip-label">${escapeHtml(skillLabel)}</span></span>`;
    }

    if (rawLabel.startsWith(FOLDER_MENTION_PREFIX)) {
      const folderLabel = rawLabel.slice(FOLDER_MENTION_PREFIX.length);
      const filePath = resolveMentionFilePath(options?.rootFolder, folderLabel);
      const filePathAttrs = filePath
        ? ` data-file-path="${escapeHtml(filePath)}" title="Open in VS Code"`
        : '';
      const clickableClass = filePath ? ' chat-mention-chip--clickable' : '';
      const interactiveAttrs = filePath ? ' role="button" tabindex="0"' : '';
      return `<span class="chat-mention-chip chat-mention-chip--folder${clickableClass}" data-node-type="folder"${filePathAttrs}${interactiveAttrs}><span class="chat-mention-chip-icon"><svg width="12" height="12" viewBox="0 0 14 14" fill="none">${mentionIconSvg('folder')}</svg></span><span class="chat-mention-chip-label">${escapeHtml(folderLabel)}/</span></span>`;
    }

    if (rawLabel.startsWith(TAG_MENTION_PREFIX)) {
      const tagLabel = rawLabel.slice(TAG_MENTION_PREFIX.length);
      return `<span class="chat-mention-chip chat-mention-chip--tag" data-node-type="tag"><span class="chat-mention-chip-icon"><span class="chat-mention-chip-hash">#</span></span><span class="chat-mention-chip-label">${escapeHtml(tagLabel)}</span></span>`;
    }

    if (rawLabel.startsWith(DOM_MENTION_PREFIX)) {
      const domLabel = pipedMentionLabel(rawLabel, DOM_MENTION_PREFIX, 'DOM selection');
      return `<span class="chat-mention-chip chat-mention-chip--dom" data-node-type="dom"><span class="chat-mention-chip-icon"><svg width="12" height="12" viewBox="0 0 14 14" fill="none">${mentionIconSvg('dom')}</svg></span><span class="chat-mention-chip-label">${escapeHtml(domLabel)}</span></span>`;
    }

    if (rawLabel.startsWith(TAB_MENTION_PREFIX)) {
      return renderTabMentionHtml(rawLabel);
    }

    if (rawLabel.startsWith(ROLE_MENTION_PREFIX)) {
      const roleLabel = pipedMentionLabel(rawLabel, ROLE_MENTION_PREFIX, 'Role');
      const body = rawLabel.slice(ROLE_MENTION_PREFIX.length);
      const pipeIndex = body.indexOf('|');
      const roleId = pipeIndex >= 0 ? body.slice(0, pipeIndex) : body;
      const accent = roleAccentStyleAttr(options?.roleColors?.get(roleId));
      return `<span class="chat-mention-chip chat-mention-chip--role" data-node-type="role"${accent}><span class="chat-mention-chip-icon"><svg width="12" height="12" viewBox="0 0 14 14" fill="none">${mentionIconSvg('role')}</svg></span><span class="chat-mention-chip-label">${escapeHtml(roleLabel)}</span></span>`;
    }

    if (rawLabel.startsWith(SESSION_MENTION_PREFIX)) {
      const sessionRef = parseSessionMention(rawLabel);
      if (sessionRef) {
        const indexAttr = sessionRef.messageIndex !== undefined
          ? ` data-message-index="${sessionRef.messageIndex}"`
          : '';
        return `<span class="chat-mention-chip chat-mention-chip--session chat-mention-chip--clickable" role="button" tabindex="0" data-action="session-jump" data-session-id="${escapeHtml(sessionRef.sessionId)}" data-workspace-id="${escapeHtml(sessionRef.workspaceId)}"${indexAttr}><span class="chat-mention-chip-icon"><svg width="12" height="12" viewBox="0 0 14 14" fill="none">${mentionIconSvg('session')}</svg></span><span class="chat-mention-chip-label">${escapeHtml(sessionRef.label)}</span></span>`;
      }
      // Malformed marker — fall through to render as a plain (non-clickable) chip.
      return `<span class="chat-mention-chip chat-mention-chip--session"><span class="chat-mention-chip-label">${escapeHtml(rawLabel.slice(SESSION_MENTION_PREFIX.length))}</span></span>`;
    }

    const node = nodes?.find(item => item.title === rawLabel);
    const nodeType = node?.type ?? 'file';
    const nodeId = node?.id ?? '';
    const filePath = node ? '' : resolveMentionFilePath(options?.rootFolder, rawLabel);
    const filePathAttrs = filePath
      ? ` data-file-path="${escapeHtml(filePath)}" title="Open in VS Code"`
      : '';
    const clickableClass = nodeId || filePath ? ' chat-mention-chip--clickable' : '';
    const interactiveAttrs = nodeId || filePath ? ' role="button" tabindex="0"' : '';
    return `<span class="chat-mention-chip${clickableClass}" data-node-type="${escapeHtml(nodeType)}" data-node-id="${escapeHtml(nodeId)}"${filePathAttrs}${interactiveAttrs}><span class="chat-mention-chip-icon"><svg width="12" height="12" viewBox="0 0 14 14" fill="none">${mentionIconSvg(nodeType)}</svg></span><span class="chat-mention-chip-label">${escapeHtml(rawLabel)}</span></span>`;
  }));

  const withRoles = options?.roleNames
    ? renderRoleNameMentions(withMarkers, options.roleNames)
    : withMarkers;
  return restoreMentionMarkersInAttributes(withRoles, protectedMentions.markers);
}
