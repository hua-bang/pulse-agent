import { createElement, type ReactNode } from 'react';
import type { AgentContextTabRef, AgentRequestContext } from '../../../types';
import { TAB_MENTION_PREFIX } from '../constants';
import type { MentionItem } from '../types';
import { decodeMentionPart, encodeMentionPart } from './mentionMarkers';
import { MentionNodeIcon, mentionIconSvg } from './mentionIcons';

type TabKind = AgentContextTabRef['kind'];

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Icon node-type used to render a tab mention chip, by tab kind. */
export function tabMentionIconType(kind: TabKind | undefined): string {
  switch (kind) {
    case 'terminal':
      return 'terminal';
    case 'node-detail':
      return 'file';
    case 'canvas':
      return 'workspace';
    case 'link':
    case 'artifact':
    default:
      return 'iframe';
  }
}

export interface TabMentionRef {
  id: string;
  kind: TabKind;
  label: string;
  dockWorkspaceId?: string;
  url?: string;
  workspaceId?: string;
  nodeId?: string;
  artifactId?: string;
  sessionId?: string;
}

type PersistedTabIdentity = Pick<
  TabMentionRef,
  'url' | 'workspaceId' | 'nodeId' | 'artifactId' | 'sessionId'
>;

// `=` avoids Markdown's linkifier treating the payload as a `ref:` URL before
// mention rendering gets a chance to parse it.
const TAB_IDENTITY_PREFIX = 'ref=';

function isTabKind(value: string): value is TabKind {
  return value === 'link'
    || value === 'node-detail'
    || value === 'artifact'
    || value === 'canvas'
    || value === 'terminal';
}

function persistedTabIdentity(tab: AgentContextTabRef): PersistedTabIdentity {
  return {
    ...(tab.url ? { url: tab.url } : {}),
    ...(tab.workspaceId ? { workspaceId: tab.workspaceId } : {}),
    ...(tab.nodeId ? { nodeId: tab.nodeId } : {}),
    ...(tab.artifactId ? { artifactId: tab.artifactId } : {}),
    ...(tab.sessionId ? { sessionId: tab.sessionId } : {}),
  };
}

function encodeTabIdentity(tab: AgentContextTabRef): string {
  const identity = persistedTabIdentity(tab);
  const json = JSON.stringify(identity);
  const payload = Array.from(new TextEncoder().encode(json), (byte) =>
    byte.toString(16).padStart(2, '0')).join('');
  return Object.keys(identity).length > 0
    ? `|${TAB_IDENTITY_PREFIX}${payload}`
    : '';
}

function parseTabIdentity(part: string | undefined): PersistedTabIdentity {
  if (!part?.startsWith(TAB_IDENTITY_PREFIX)) return {};
  try {
    const payload = part.slice(TAB_IDENTITY_PREFIX.length);
    if (!/^(?:[0-9a-f]{2})+$/i.test(payload)) return {};
    const bytes = Uint8Array.from(
      payload.match(/.{2}/g) ?? [],
      (pair) => Number.parseInt(pair, 16),
    );
    const value = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const record = value as Record<string, unknown>;
    const stringField = (key: keyof PersistedTabIdentity): string | undefined =>
      typeof record[key] === 'string' && record[key] ? record[key] : undefined;
    const url = stringField('url');
    const workspaceId = stringField('workspaceId');
    const nodeId = stringField('nodeId');
    const artifactId = stringField('artifactId');
    const sessionId = stringField('sessionId');
    return {
      ...(url ? { url } : {}),
      ...(workspaceId ? { workspaceId } : {}),
      ...(nodeId ? { nodeId } : {}),
      ...(artifactId ? { artifactId } : {}),
      ...(sessionId ? { sessionId } : {}),
    };
  } catch {
    return {};
  }
}

/**
 * Parse a tab citation. Current markers include the dock workspace so a
 * historical chip can reopen the right workspace before activating its tab:
 * `tab:<encId>|<kind>|<encDockWorkspaceId>|<encLabel>|ref=<hex-json>`.
 * Both previous three- and four-part markers remain readable.
 */
export function parseTabMention(rawLabel: string): TabMentionRef | null {
  const body = rawLabel.slice(TAB_MENTION_PREFIX.length);
  const parts = body.split('|');
  if (parts.length < 3) return null;
  const id = decodeMentionPart(parts[0]);
  const kind = parts[1];
  if (!isTabKind(kind)) return null;
  const identityPart = parts.length >= 4 && parts.at(-1)?.startsWith(TAB_IDENTITY_PREFIX)
    ? parts.pop()
    : undefined;
  const hasDockWorkspace = parts.length >= 4;
  const dockWorkspaceId = hasDockWorkspace ? decodeMentionPart(parts[2]) : undefined;
  const label = decodeMentionPart(parts.slice(hasDockWorkspace ? 3 : 2).join('|'));
  if (!id) return null;
  return {
    id,
    kind,
    label: label || id,
    dockWorkspaceId: dockWorkspaceId || undefined,
    ...parseTabIdentity(identityPart),
  };
}

/**
 * Build a composer chip for a right-dock tab mention. The full tab ref is
 * carried in data-* so collectTabRefsFromEditable can recover it at send time,
 * and the chip serializes to a
 * `@[tab:<id>|<kind>|<dockWorkspaceId>|<label>|ref=<hex-json>]` marker when
 * dock ownership / resource identity are known (legacy fields stay optional).
 */
export function buildTabMentionChip(item: MentionItem, nodeType: string): HTMLSpanElement {
  const tab = item.tab!;
  const label = item.label || tab.title;
  const chip = document.createElement('span');
  chip.className = 'chat-mention-chip chat-mention-chip--input chat-mention-chip--tab';
  chip.contentEditable = 'false';
  const dockWorkspacePart = tab.dockWorkspaceId
    ? `|${encodeMentionPart(tab.dockWorkspaceId)}`
    : '';
  chip.dataset.mention = `${TAB_MENTION_PREFIX}${encodeMentionPart(tab.id)}|${tab.kind}${dockWorkspacePart}|${encodeMentionPart(label)}${encodeTabIdentity(tab)}`;
  chip.dataset.nodeType = nodeType;
  chip.dataset.mentionKind = 'tab';
  chip.dataset.tabId = tab.id;
  chip.dataset.tabKind = tab.kind;
  chip.dataset.tabTitle = tab.title;
  if (tab.url) chip.dataset.tabUrl = tab.url;
  if (tab.workspaceId) chip.dataset.tabWorkspaceId = tab.workspaceId;
  if (tab.dockWorkspaceId) chip.dataset.tabDockWorkspaceId = tab.dockWorkspaceId;
  if (tab.nodeId) chip.dataset.tabNodeId = tab.nodeId;
  if (tab.artifactId) chip.dataset.tabArtifactId = tab.artifactId;
  if (tab.sessionId) chip.dataset.tabSessionId = tab.sessionId;
  if (item.description) {
    chip.dataset.tabDescription = item.description;
    chip.setAttribute('aria-label', `${label} · ${item.description}`);
    chip.title = item.description;
  }

  const iconSpan = document.createElement('span');
  iconSpan.className = 'chat-mention-chip-icon';
  iconSpan.innerHTML = `<svg width="12" height="12" viewBox="0 0 14 14" fill="none">${mentionIconSvg(nodeType)}</svg>`;
  chip.appendChild(iconSpan);

  const labelSpan = document.createElement('span');
  labelSpan.className = 'chat-mention-chip-label';
  labelSpan.textContent = label;
  chip.appendChild(labelSpan);
  if (item.description) {
    const metaSpan = document.createElement('span');
    metaSpan.className = 'chat-mention-chip-meta';
    metaSpan.textContent = item.description;
    chip.appendChild(metaSpan);
  }
  return chip;
}

/**
 * Collect right-dock tab refs from the composer chips. Runs for BOTH hosts
 * (workspace canvas chat and the global assistant), since a mentioned tab is
 * always readable context the agent should be able to open.
 */
export function collectTabRefsFromEditable(editable: HTMLElement): AgentContextTabRef[] {
  const tabs: AgentContextTabRef[] = [];
  const chips = editable.querySelectorAll<HTMLElement>('[data-mention-kind="tab"]');
  chips.forEach((chip) => {
    const id = chip.dataset.tabId;
    const kind = chip.dataset.tabKind as TabKind | undefined;
    if (!id || !kind) return;
    tabs.push({
      id,
      kind,
      title: chip.dataset.tabTitle ?? chip.querySelector('.chat-mention-chip-label')?.textContent ?? id,
      url: chip.dataset.tabUrl || undefined,
      workspaceId: chip.dataset.tabWorkspaceId || undefined,
      dockWorkspaceId: chip.dataset.tabDockWorkspaceId || undefined,
      nodeId: chip.dataset.tabNodeId || undefined,
      artifactId: chip.dataset.tabArtifactId || undefined,
      sessionId: chip.dataset.tabSessionId || undefined,
    });
  });
  return tabs;
}

/** Recover the persisted tab identity from a transcript chip's data attrs. */
export function tabRefFromMentionElement(element: HTMLElement): AgentContextTabRef | undefined {
  const id = element.dataset.tabId;
  const kind = element.dataset.tabKind;
  if (!id || !kind || !isTabKind(kind)) return undefined;
  return {
    id,
    kind,
    title: element.querySelector('.chat-mention-chip-label')?.textContent?.trim() || id,
    url: element.dataset.tabUrl || undefined,
    workspaceId: element.dataset.tabWorkspaceId || undefined,
    dockWorkspaceId: element.dataset.dockWorkspaceId || undefined,
    nodeId: element.dataset.tabNodeId || undefined,
    artifactId: element.dataset.tabArtifactId || undefined,
    sessionId: element.dataset.tabSessionId || undefined,
  };
}

/** Project open dock tabs into `@`-popup mention items. */
export function buildTabMentionItems(
  dockTabs: AgentContextTabRef[],
  describe?: (tab: AgentContextTabRef) => string | undefined,
): MentionItem[] {
  return dockTabs.map((tab) => ({
    type: 'tab',
    label: tab.title || tab.url || tab.kind,
    description: describe?.(tab),
    tab,
  }));
}

/**
 * Merge tab refs collected from the composer chips into a request context.
 * Returns `ctx` unchanged when no tab was mentioned.
 */
export function withCollectedTabs(
  editable: HTMLElement,
  ctx: AgentRequestContext | undefined,
): AgentRequestContext | undefined {
  const tabs = collectTabRefsFromEditable(editable);
  if (!tabs.length) return ctx;
  return { ...(ctx ?? {}), tabs: [...(ctx?.tabs ?? []), ...tabs] };
}

/** Render a tab marker as a React chip in the message transcript. Clickable
 *  (data-action="tab-jump") so it activates the referenced dock tab. */
export function renderTabMentionNode(rawLabel: string, key: number): ReactNode {
  const tabRef = parseTabMention(rawLabel);
  const nodeType = tabMentionIconType(tabRef?.kind);
  const clickable = Boolean(tabRef?.id);
  return createElement(
    'span',
    {
      key,
      className: `chat-mention-chip chat-mention-chip--tab${clickable ? ' chat-mention-chip--clickable' : ''}`,
      'data-node-type': nodeType,
      ...(clickable
        ? {
            role: 'button',
            tabIndex: 0,
            'data-action': 'tab-jump',
            'data-tab-id': tabRef!.id,
            'data-tab-kind': tabRef!.kind,
            ...(tabRef!.dockWorkspaceId
              ? { 'data-dock-workspace-id': tabRef!.dockWorkspaceId }
              : {}),
            ...(tabRef!.url ? { 'data-tab-url': tabRef!.url } : {}),
            ...(tabRef!.workspaceId ? { 'data-tab-workspace-id': tabRef!.workspaceId } : {}),
            ...(tabRef!.nodeId ? { 'data-tab-node-id': tabRef!.nodeId } : {}),
            ...(tabRef!.artifactId ? { 'data-tab-artifact-id': tabRef!.artifactId } : {}),
            ...(tabRef!.sessionId ? { 'data-tab-session-id': tabRef!.sessionId } : {}),
          }
        : {}),
    } as Record<string, unknown>,
    createElement(
      'span',
      { className: 'chat-mention-chip-icon' },
      createElement(MentionNodeIcon, { nodeType }),
    ),
    createElement('span', { className: 'chat-mention-chip-label' }, tabRef?.label ?? 'Tab'),
  );
}

/** Render a tab marker as an HTML chip in markdown-rendered content. Clickable
 *  (data-action="tab-jump") so it activates the referenced dock tab. */
export function renderTabMentionHtml(rawLabel: string): string {
  const tabRef = parseTabMention(rawLabel);
  const nodeType = tabMentionIconType(tabRef?.kind);
  const label = tabRef?.label ?? 'Tab';
  const clickableClass = tabRef?.id ? ' chat-mention-chip--clickable' : '';
  const dockWorkspaceAttr = tabRef?.dockWorkspaceId
    ? ` data-dock-workspace-id="${escapeHtml(tabRef.dockWorkspaceId)}"`
    : '';
  const identityAttrs = tabRef
    ? [
        ['data-tab-kind', tabRef.kind],
        ['data-tab-url', tabRef.url],
        ['data-tab-workspace-id', tabRef.workspaceId],
        ['data-tab-node-id', tabRef.nodeId],
        ['data-tab-artifact-id', tabRef.artifactId],
        ['data-tab-session-id', tabRef.sessionId],
      ].filter((entry): entry is [string, string] => Boolean(entry[1]))
        .map(([name, value]) => ` ${name}="${escapeHtml(value)}"`).join('')
    : '';
  const jumpAttrs = tabRef?.id
    ? ` role="button" tabindex="0" data-action="tab-jump" data-tab-id="${escapeHtml(tabRef.id)}"${dockWorkspaceAttr}${identityAttrs}`
    : '';
  return `<span class="chat-mention-chip chat-mention-chip--tab${clickableClass}" data-node-type="${escapeHtml(nodeType)}"${jumpAttrs}><span class="chat-mention-chip-icon"><svg width="12" height="12" viewBox="0 0 14 14" fill="none">${mentionIconSvg(nodeType)}</svg></span><span class="chat-mention-chip-label">${escapeHtml(label)}</span></span>`;
}
