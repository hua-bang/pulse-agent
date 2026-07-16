import { createElement, type ReactNode } from 'react';
import type { AgentContextCanvasRef, AgentContextDomSelectionRef, AgentContextNodeRef, AgentContextTagRef, CanvasNode } from '../../../types';
import { CANVAS_MENTION_PREFIX, DOM_MENTION_PREFIX, FOLDER_MENTION_PREFIX, SESSION_MENTION_PREFIX, SKILL_MENTION_PREFIX, TAG_MENTION_PREFIX } from '../constants';
import type { MentionItem, WorkspaceOption } from '../types';
import { renderMarkdown, type RenderMarkdownOptions } from './markdown';
import { MENTION_RE, encodeMentionPart, pipedMentionLabel } from './mentionMarkers';
import { readDomSelectionDataset, writeDomSelectionDataset } from './domMentionData';
import { sessionTitleText } from './sessionTitle';

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

export function mentionIconSvg(nodeType: string): string {
  switch (nodeType) {
    case 'terminal':
      return '<rect x="1.5" y="2" width="11" height="10" rx="1.5" stroke="currentColor" stroke-width="1.2"/><path d="M4 6l2 1.5L4 9" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>';
    case 'agent':
      return '<circle cx="7" cy="5" r="2.5" stroke="currentColor" stroke-width="1.2"/><path d="M3.5 12c0-1.9 1.6-3.5 3.5-3.5s3.5 1.6 3.5 3.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>';
    case 'frame':
      return '<rect x="2" y="2" width="10" height="10" rx="2" stroke="currentColor" stroke-width="1.2"/>';
    case 'group':
      return '<rect x="2" y="2.5" width="10" height="9" rx="1.8" stroke="currentColor" stroke-width="1.2" stroke-dasharray="2 1.6"/><path d="M4.5 5.5h5M4.5 8.5h5" stroke="currentColor" stroke-width="1" stroke-linecap="round"/>';
    case 'text':
      return '<path d="M3 3.5h8M7 3.5v7M5.5 10.5h3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>';
    case 'iframe':
      return '<circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="1.2"/><path d="M2 7h10M7 2c1.7 1.7 1.7 8.3 0 10M7 2c-1.7 1.7-1.7 8.3 0 10" stroke="currentColor" stroke-width="1" stroke-linecap="round"/>';
    case 'mindmap':
      return '<circle cx="3.5" cy="7" r="1.2" stroke="currentColor" stroke-width="1.1"/><circle cx="10.5" cy="3.5" r="1.1" stroke="currentColor" stroke-width="1.1"/><circle cx="10.5" cy="7" r="1.1" stroke="currentColor" stroke-width="1.1"/><circle cx="10.5" cy="10.5" r="1.1" stroke="currentColor" stroke-width="1.1"/><path d="M4.7 7L9.4 3.7M4.7 7H9.4M4.7 7L9.4 10.3" stroke="currentColor" stroke-width="1" stroke-linecap="round"/>';
    case 'workspace':
      return '<rect x="1.5" y="1.5" width="11" height="11" rx="1.5" stroke="currentColor" stroke-width="1.2"/><rect x="3.5" y="3.5" width="3" height="3" rx="0.5" stroke="currentColor" stroke-width="1"/><rect x="7.5" y="3.5" width="3" height="3" rx="0.5" stroke="currentColor" stroke-width="1"/><rect x="3.5" y="7.5" width="3" height="3" rx="0.5" stroke="currentColor" stroke-width="1"/>';
    case 'skill':
      return '<path d="M7 1.5l1.6 3.4 3.7.5-2.7 2.5.7 3.6L7 9.8l-3.3 1.7.7-3.6L1.7 5.4l3.7-.5L7 1.5z" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/>';
    case 'folder':
      return '<path d="M1.5 4.5a1 1 0 0 1 1-1H6l1.2 1.5h4.3a1 1 0 0 1 1 1v5.5a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V4.5z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>';
    case 'session':
      return '<path d="M2.5 3h9a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H6.8L4 12.2V10H2.5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M4.5 5.8h5M4.5 7.8h3" stroke="currentColor" stroke-width="1" stroke-linecap="round"/>';
    case 'dom':
      return '<rect x="2" y="2" width="10" height="10" rx="1.5" stroke="currentColor" stroke-width="1.2"/><path d="M4.2 5.2L2.8 7l1.4 1.8M9.8 5.2L11.2 7 9.8 8.8M6.2 10.2L7.8 3.8" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>';
    default:
      return '<rect x="2" y="1.5" width="10" height="11" rx="1.5" stroke="currentColor" stroke-width="1.2"/><path d="M4.5 5h5M4.5 7.5h3" stroke="currentColor" stroke-width="1" stroke-linecap="round"/>';
  }
}

export function MentionNodeIcon({ nodeType, size = 12 }: { nodeType: string; size?: number }) {
  return createElement('svg', {
    width: size,
    height: size,
    viewBox: '0 0 14 14',
    fill: 'none',
    dangerouslySetInnerHTML: { __html: mentionIconSvg(nodeType) },
  });
}

export function getMentionNodeType(item: MentionItem, nodes?: CanvasNode[]): string {
  if (item.type === 'skill') return 'skill';
  if (item.type === 'workspace') return 'workspace';
  if (item.type === 'folder') return 'folder';
  if (item.type === 'node') return item.nodeType ?? 'file';
  if (item.type === 'dom') return 'dom';

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
