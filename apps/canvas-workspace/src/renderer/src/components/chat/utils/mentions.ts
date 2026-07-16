import { createElement, type ReactNode } from 'react';
import type { AgentContextCanvasRef, AgentContextDomSelectionRef, AgentContextNodeRef, AgentContextTagRef, CanvasNode } from '../../../types';
import { CANVAS_MENTION_PREFIX, DOM_MENTION_PREFIX, FOLDER_MENTION_PREFIX, SESSION_MENTION_PREFIX, SKILL_MENTION_PREFIX, TAB_MENTION_PREFIX, TAG_MENTION_PREFIX } from '../constants';
import type { MentionItem, WorkspaceOption } from '../types';
import { renderMarkdown, type RenderMarkdownOptions } from './markdown';
import { MentionNodeIcon, mentionIconSvg } from './mentionIcons';
import { MENTION_RE, encodeMentionPart, pipedMentionLabel } from './mentionMarkers';
import { readDomSelectionDataset, writeDomSelectionDataset } from './domMentionData';
import { sessionTitleText } from './sessionTitle';
import {
  buildTabMentionChip,
  renderTabMentionHtml,
  renderTabMentionNode,
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

/**
 * Collect structured, workspace-aware context refs from the inline mention
 * chips a user inserted into the composer. Used by the global Nodes/detail
 * assistant so cross-workspace `@`-mentions resolve precisely — node refs carry
 * their workspaceId, tags the workspaces they occur in, canvases their id.
 */
export function collectContextRefsFromEditable(editable: HTMLElement): {
  nodes: AgentContextNodeRef[];
  tags: AgentContextTagRef[];
  canvases: AgentContextCanvasRef[];
  domSelections: AgentContextDomSelectionRef[];
} {
  const nodes: AgentContextNodeRef[] = [];
  const tags: AgentContextTagRef[] = [];
  const canvases: AgentContextCanvasRef[] = [];
  const domSelections: AgentContextDomSelectionRef[] = [];
  const chips = editable.querySelectorAll<HTMLElement>('[data-mention-kind]');

  chips.forEach((chip) => {
    const kind = chip.dataset.mentionKind;
    const label = chip.querySelector('.chat-mention-chip-label')?.textContent ?? '';
    if (kind === 'node' && chip.dataset.nodeId) {
      nodes.push({
        id: chip.dataset.nodeId,
        title: label,
        type: (chip.dataset.nodeType ?? 'file') as CanvasNode['type'],
        workspaceId: chip.dataset.workspaceId || undefined,
      });
    } else if (kind === 'tag' && chip.dataset.tag) {
      const ids = chip.dataset.workspaceIds ? chip.dataset.workspaceIds.split(',').filter(Boolean) : [];
      tags.push({ name: chip.dataset.tag, workspaceIds: ids.length ? ids : undefined });
    } else if (kind === 'canvas' && chip.dataset.workspaceId) {
      canvases.push({ id: chip.dataset.workspaceId, name: label });
    } else if (kind === 'dom-selection') {
      const ref = readDomSelectionDataset(chip, label, domSelections.length);
      if (ref) domSelections.push(ref);
    }
  });

  return { nodes, tags, canvases, domSelections };
}

export function renderUserContent(content: string, nodes?: CanvasNode[]): ReactNode {
  const parts: ReactNode[] = [];
  const re = new RegExp(MENTION_RE.source, 'g');
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push(content.slice(lastIndex, match.index));
    }

    const rawLabel = match[1];
    if (rawLabel.startsWith(CANVAS_MENTION_PREFIX)) {
      const workspaceLabel = rawLabel.slice(CANVAS_MENTION_PREFIX.length);
      parts.push(
        createElement(
          'span',
          {
            key: match.index,
            className: 'chat-mention-chip chat-mention-chip--workspace',
            'data-node-type': 'workspace',
          } as any,
          createElement(
            'span',
            { className: 'chat-mention-chip-icon' },
            createElement(MentionNodeIcon, { nodeType: 'workspace' }),
          ),
          createElement('span', { className: 'chat-mention-chip-label' }, workspaceLabel),
        ),
      );
      lastIndex = re.lastIndex;
      continue;
    }

    if (rawLabel.startsWith(SKILL_MENTION_PREFIX)) {
      const skillLabel = rawLabel.slice(SKILL_MENTION_PREFIX.length);
      parts.push(
        createElement(
          'span',
          {
            key: match.index,
            className: 'chat-mention-chip chat-mention-chip--skill',
            'data-node-type': 'skill',
          } as any,
          createElement('span', { className: 'chat-mention-chip-label' }, skillLabel),
        ),
      );
      lastIndex = re.lastIndex;
      continue;
    }

    if (rawLabel.startsWith(FOLDER_MENTION_PREFIX)) {
      const folderLabel = rawLabel.slice(FOLDER_MENTION_PREFIX.length);
      parts.push(
        createElement(
          'span',
          {
            key: match.index,
            className: 'chat-mention-chip chat-mention-chip--folder',
            'data-node-type': 'folder',
          } as any,
          createElement(
            'span',
            { className: 'chat-mention-chip-icon' },
            createElement(MentionNodeIcon, { nodeType: 'folder' }),
          ),
          createElement('span', { className: 'chat-mention-chip-label' }, `${folderLabel}/`),
        ),
      );
      lastIndex = re.lastIndex;
      continue;
    }

    if (rawLabel.startsWith(TAG_MENTION_PREFIX)) {
      const tagLabel = rawLabel.slice(TAG_MENTION_PREFIX.length);
      parts.push(
        createElement(
          'span',
          {
            key: match.index,
            className: 'chat-mention-chip chat-mention-chip--tag',
            'data-node-type': 'tag',
          } as any,
          createElement(
            'span',
            { className: 'chat-mention-chip-icon' },
            createElement('span', { className: 'chat-mention-chip-hash' }, '#'),
          ),
          createElement('span', { className: 'chat-mention-chip-label' }, tagLabel),
        ),
      );
      lastIndex = re.lastIndex;
      continue;
    }

    if (rawLabel.startsWith(DOM_MENTION_PREFIX)) {
      const domLabel = pipedMentionLabel(rawLabel, DOM_MENTION_PREFIX, 'DOM selection');
      parts.push(
        createElement(
          'span',
          {
            key: match.index,
            className: 'chat-mention-chip chat-mention-chip--dom',
            'data-node-type': 'dom',
          } as any,
          createElement(
            'span',
            { className: 'chat-mention-chip-icon' },
            createElement(MentionNodeIcon, { nodeType: 'dom' }),
          ),
          createElement('span', { className: 'chat-mention-chip-label' }, domLabel),
        ),
      );
      lastIndex = re.lastIndex;
      continue;
    }

    if (rawLabel.startsWith(TAB_MENTION_PREFIX)) {
      parts.push(renderTabMentionNode(rawLabel, match.index));
      lastIndex = re.lastIndex;
      continue;
    }

    const node = nodes?.find(item => item.title === rawLabel);
    parts.push(
      createElement(
        'span',
        {
          key: match.index,
          className: 'chat-mention-chip chat-mention-chip--clickable',
          'data-node-type': node?.type,
          'data-node-id': node?.id,
        } as any,
        createElement(
          'span',
          { className: 'chat-mention-chip-icon' },
          createElement(MentionNodeIcon, { nodeType: node?.type ?? 'file' }),
        ),
        createElement('span', { className: 'chat-mention-chip-label' }, rawLabel),
      ),
    );
    lastIndex = re.lastIndex;
  }

  if (lastIndex < content.length) {
    parts.push(content.slice(lastIndex));
  }

  return parts.length > 0 ? parts : content;
}

export function renderMdWithMentions(
  content: string,
  nodes?: CanvasNode[],
  options?: RenderMarkdownOptions & { rootFolder?: string },
): string {
  const html = renderMarkdown(content, options);

  return html.replace(MENTION_RE, (_match, rawLabel: string) => {
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
      return `<span class="chat-mention-chip chat-mention-chip--folder${clickableClass}" data-node-type="folder"${filePathAttrs}><span class="chat-mention-chip-icon"><svg width="12" height="12" viewBox="0 0 14 14" fill="none">${mentionIconSvg('folder')}</svg></span><span class="chat-mention-chip-label">${escapeHtml(folderLabel)}/</span></span>`;
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

    if (rawLabel.startsWith(SESSION_MENTION_PREFIX)) {
      const sessionRef = parseSessionMention(rawLabel);
      if (sessionRef) {
        const indexAttr = sessionRef.messageIndex !== undefined
          ? ` data-message-index="${sessionRef.messageIndex}"`
          : '';
        return `<span class="chat-mention-chip chat-mention-chip--session chat-mention-chip--clickable" data-action="session-jump" data-session-id="${escapeHtml(sessionRef.sessionId)}" data-workspace-id="${escapeHtml(sessionRef.workspaceId)}"${indexAttr}><span class="chat-mention-chip-icon"><svg width="12" height="12" viewBox="0 0 14 14" fill="none">${mentionIconSvg('session')}</svg></span><span class="chat-mention-chip-label">${escapeHtml(sessionRef.label)}</span></span>`;
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
    return `<span class="chat-mention-chip${clickableClass}" data-node-type="${escapeHtml(nodeType)}" data-node-id="${escapeHtml(nodeId)}"${filePathAttrs}><span class="chat-mention-chip-icon"><svg width="12" height="12" viewBox="0 0 14 14" fill="none">${mentionIconSvg(nodeType)}</svg></span><span class="chat-mention-chip-label">${escapeHtml(rawLabel)}</span></span>`;
  });
}
