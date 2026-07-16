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
}

/**
 * Parse a tab citation `tab:<encId>|<kind>|<encLabel>` (the leading `@[` /
 * trailing `]` already stripped by MENTION_RE). Returns null when malformed.
 */
export function parseTabMention(rawLabel: string): TabMentionRef | null {
  const body = rawLabel.slice(TAB_MENTION_PREFIX.length);
  const parts = body.split('|');
  if (parts.length < 3) return null;
  const id = decodeMentionPart(parts[0]);
  const kind = parts[1] as TabKind;
  const label = decodeMentionPart(parts.slice(2).join('|'));
  if (!id || !kind) return null;
  return { id, kind, label: label || id };
}

/**
 * Build a composer chip for a right-dock tab mention. The full tab ref is
 * carried in data-* so collectTabRefsFromEditable can recover it at send time,
 * and the chip serializes to a `@[tab:<id>|<kind>|<label>]` marker.
 */
export function buildTabMentionChip(item: MentionItem, nodeType: string): HTMLSpanElement {
  const tab = item.tab!;
  const label = item.label || tab.title;
  const chip = document.createElement('span');
  chip.className = 'chat-mention-chip chat-mention-chip--input chat-mention-chip--tab';
  chip.contentEditable = 'false';
  chip.dataset.mention = `${TAB_MENTION_PREFIX}${encodeMentionPart(tab.id)}|${tab.kind}|${encodeMentionPart(label)}`;
  chip.dataset.nodeType = nodeType;
  chip.dataset.mentionKind = 'tab';
  chip.dataset.tabId = tab.id;
  chip.dataset.tabKind = tab.kind;
  chip.dataset.tabTitle = tab.title;
  if (tab.url) chip.dataset.tabUrl = tab.url;
  if (tab.workspaceId) chip.dataset.tabWorkspaceId = tab.workspaceId;
  if (tab.nodeId) chip.dataset.tabNodeId = tab.nodeId;
  if (tab.artifactId) chip.dataset.tabArtifactId = tab.artifactId;
  if (tab.sessionId) chip.dataset.tabSessionId = tab.sessionId;

  const iconSpan = document.createElement('span');
  iconSpan.className = 'chat-mention-chip-icon';
  iconSpan.innerHTML = `<svg width="12" height="12" viewBox="0 0 14 14" fill="none">${mentionIconSvg(nodeType)}</svg>`;
  chip.appendChild(iconSpan);

  const labelSpan = document.createElement('span');
  labelSpan.className = 'chat-mention-chip-label';
  labelSpan.textContent = label;
  chip.appendChild(labelSpan);
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
      nodeId: chip.dataset.tabNodeId || undefined,
      artifactId: chip.dataset.tabArtifactId || undefined,
      sessionId: chip.dataset.tabSessionId || undefined,
    });
  });
  return tabs;
}

/** Project open dock tabs into `@`-popup mention items. */
export function buildTabMentionItems(dockTabs: AgentContextTabRef[]): MentionItem[] {
  return dockTabs.map((tab) => ({ type: 'tab', label: tab.title || tab.url || tab.kind, tab }));
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

/** Render a tab marker as a React chip in the message transcript. */
export function renderTabMentionNode(rawLabel: string, key: number): ReactNode {
  const tabRef = parseTabMention(rawLabel);
  const nodeType = tabMentionIconType(tabRef?.kind);
  return createElement(
    'span',
    {
      key,
      className: 'chat-mention-chip chat-mention-chip--tab',
      'data-node-type': nodeType,
    } as Record<string, unknown>,
    createElement(
      'span',
      { className: 'chat-mention-chip-icon' },
      createElement(MentionNodeIcon, { nodeType }),
    ),
    createElement('span', { className: 'chat-mention-chip-label' }, tabRef?.label ?? 'Tab'),
  );
}

/** Render a tab marker as an HTML chip in markdown-rendered content. */
export function renderTabMentionHtml(rawLabel: string): string {
  const tabRef = parseTabMention(rawLabel);
  const nodeType = tabMentionIconType(tabRef?.kind);
  const label = tabRef?.label ?? 'Tab';
  return `<span class="chat-mention-chip chat-mention-chip--tab" data-node-type="${escapeHtml(nodeType)}"><span class="chat-mention-chip-icon"><svg width="12" height="12" viewBox="0 0 14 14" fill="none">${mentionIconSvg(nodeType)}</svg></span><span class="chat-mention-chip-label">${escapeHtml(label)}</span></span>`;
}
