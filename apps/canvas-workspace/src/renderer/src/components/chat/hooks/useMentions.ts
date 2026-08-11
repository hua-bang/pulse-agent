import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { AgentContextTabRef, AgentRequestContext, CanvasNode, ChatImageAttachment } from '../../../types';
import { isImeComposing } from '../../../utils/ime';
import {
  MENTION_MAX_ITEMS,
  sortAndCapMentionItems,
} from '../constants';
import type { MentionItem, WorkspaceOption } from '../types';
import type { AgentScope } from '../types';
import { buildTabMentionItems, collectContextRefsFromEditable, createMentionChipElement, serializeEditable, withCollectedTabs } from '../utils/mentions';
import { flattenEntries } from './fileMentionItems';
import { loadRoleMentionItems } from './roleMentionItems';
import { useEditableInputControl } from './useEditableInputControl';
import { useSkillMentionInsertion } from './useSkillMentionInsertion';
import { chatScopeId } from '../chatScope';
import {
  getChatComposerDraft,
  subscribeChatComposerDraft,
  updateChatComposerDraft,
} from './chatComposerDraftStore';
import { useChatAttachments } from './useChatAttachments';
import { buildStaticMentionItems } from './staticMentionItems';
import { useI18n, type I18nKey } from '../../../i18n';
import { useContextMentionInsertions } from './useContextMentionInsertions';

const tabKindLabelKey = (kind: AgentContextTabRef['kind']): I18nKey => {
  switch (kind) {
    case 'link': return 'chat.tabKind.link';
    case 'artifact': return 'chat.tabKind.artifact';
    case 'node-detail': return 'chat.tabKind.nodeDetail';
    case 'canvas': return 'chat.tabKind.canvas';
    case 'terminal': return 'chat.tabKind.terminal';
  }
};
interface UseMentionsOptions {
  allWorkspaces?: WorkspaceOption[];
  agentScope: AgentScope;
  nodes?: CanvasNode[];
  rootFolder?: string;
  /** Cross-workspace knowledge nodes offered in the `@` popup (global host). */
  knowledgeNodes?: Array<{ id: string; title: string; type: CanvasNode['type']; workspaceId?: string }>;
  /** Knowledge tags offered in the `@` popup (global host). */
  knowledgeTags?: Array<{ id: string; name: string; workspaceIds?: string[] }>;
  dockTabs?: AgentContextTabRef[];
  /**
   * When true, structured context (with workspaceId) is collected from the
   * inline mention chips at send time and merged into the request context.
   * Enabled by the global Nodes/detail assistant; off for the canvas panel.
   */
  collectStructuredContext?: boolean;
  onSubmit: (text: string, requestContext?: AgentRequestContext, attachments?: ChatImageAttachment[]) => Promise<boolean>;
  getRequestContext?: () => AgentRequestContext | undefined;
  /**
   * Veto checked immediately before a send, keeping the draft intact. Lives
   * here rather than in each caller's submit handler because the composer has
   * TWO submit paths — the send button and handleKeyDown's Enter, which calls
   * submitCurrentInput directly — and a guard in only one of them is a hole.
   */
  isSubmitBlocked?: () => boolean;
}

export function useMentions({
  allWorkspaces,
  agentScope,
  nodes,
  rootFolder,
  knowledgeNodes,
  knowledgeTags,
  dockTabs,
  collectStructuredContext,
  onSubmit,
  getRequestContext,
  isSubmitBlocked,
}: UseMentionsOptions) {
  const { t } = useI18n();
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionItems, setMentionItems] = useState<MentionItem[]>([]);
  const [mentionIndex, setMentionIndex] = useState(0);
  const editableRef = useRef<HTMLDivElement>(null);
  const filesCacheRef = useRef(new Map<string, MentionItem[]>());
  const skillsCacheRef = useRef(new Map<string, MentionItem[]>());
  const workspaceId = agentScope.kind === 'workspace' ? agentScope.workspaceId : undefined;
  const attachmentsEnabled = agentScope.kind === 'workspace';
  const scopeId = chatScopeId(agentScope);
  const subscribeDraft = useCallback(
    (listener: () => void) => subscribeChatComposerDraft(scopeId, listener),
    [scopeId],
  );
  const readDraft = useCallback(() => getChatComposerDraft(scopeId), [scopeId]);
  const draft = useSyncExternalStore(subscribeDraft, readDraft, readDraft);
  const input = draft.input;
  const attachments = draft.attachments;
  const setInput = useCallback((value: string) => {
    updateChatComposerDraft(scopeId, previous => ({
      ...previous,
      input: value,
      html: editableRef.current?.innerHTML ?? previous.html,
    }));
  }, [scopeId]);
  const setAttachments = useCallback((
    value: ChatImageAttachment[] | ((previous: ChatImageAttachment[]) => ChatImageAttachment[]),
  ) => {
    updateChatComposerDraft(scopeId, previous => ({
      ...previous,
      attachments: typeof value === 'function' ? value(previous.attachments) : value,
    }));
  }, [scopeId]);
  const chatAttachments = useChatAttachments({
    scopeId,
    attachments,
    setAttachments,
  });
  const handleAttachFiles = useCallback((files: FileList | File[]) => {
    if (attachmentsEnabled) chatAttachments.handleAttachFiles(files);
  }, [attachmentsEnabled, chatAttachments.handleAttachFiles]);

  useLayoutEffect(() => {
    const element = editableRef.current;
    if (element && element.innerHTML !== draft.html) element.innerHTML = draft.html;
  }, [draft.html, scopeId]);

  useEffect(() => {
    mentionBuildSeqRef.current++;
    setMentionOpen(false);
    setMentionItems([]);
    setMentionIndex(0);
  }, [scopeId]);
  /** Trigger whose query selectMention must replace. */
  const mentionTriggerRef = useRef<'@' | '/'>('@');
  /** Prevents stale async popup builds from repainting or reopening. */
  const mentionBuildSeqRef = useRef(0);

  const describeTab = useCallback((tab: AgentContextTabRef): string => {
    const type = t(tabKindLabelKey(tab.kind));
    const owningWorkspaceId = tab.workspaceId ?? tab.dockWorkspaceId;
    const workspace = owningWorkspaceId
      ? allWorkspaces?.find(item => item.id === owningWorkspaceId)?.name ?? owningWorkspaceId
      : undefined;
    const description = workspace
      ? t('chat.tabMention.description', { type, workspace })
      : type;
    return tab.isActive
      ? t('chat.tabMention.current', { description })
      : description;
  }, [allWorkspaces, t]);
  const { insertNodeMention, insertDomSelectionMention, insertTabMention } = useContextMentionInsertions({
    editableRef, nodes, workspaceId, setInput, describeTab,
  });

  const insertSkillMention = useSkillMentionInsertion({ editableRef, nodes, setInput });
  const { clearInput, focusInput, replaceInput } = useEditableInputControl({
    editableRef,
    mentionBuildSeqRef,
    setInput,
    setMentionOpen,
    setMentionItems,
    setMentionIndex,
    setAttachments,
  });

  const loadSkillItems = useCallback(async (): Promise<MentionItem[]> => {
    const cached = skillsCacheRef.current.get(scopeId);
    if (cached) return cached;
    try {
      const result = await window.canvasWorkspace.agent.listSkills({ scope: agentScope });
      const items: MentionItem[] = result.ok && result.skills
        ? result.skills.map(s => ({ type: 'skill', label: s.name, description: s.description }))
        : [];
      skillsCacheRef.current.set(scopeId, items);
    } catch {
      skillsCacheRef.current.set(scopeId, []);
    }
    return skillsCacheRef.current.get(scopeId) ?? [];
  }, [agentScope, scopeId]);

  const buildMentionItems = useCallback(async (query: string, trigger: '@' | '/') => {
    if (trigger === '/') {
      const skills = await loadSkillItems();
      const normalized = query.toLowerCase();
      const filtered = normalized
        ? skills.filter(item =>
            item.label.toLowerCase().includes(normalized)
            || (item.description ?? '').toLowerCase().includes(normalized),
          )
        : skills;
      return filtered.slice(0, MENTION_MAX_ITEMS);
    }

    const items: MentionItem[] = [];

    // Chat roles lead the popup — addressing a persona is the primary reason
    // to type `@` in a role-enabled conversation.
    items.push(...await loadRoleMentionItems());

    if (dockTabs) items.push(...buildTabMentionItems(dockTabs, describeTab));

    items.push(...buildStaticMentionItems({
      allWorkspaces,
      workspaceId,
      nodes,
      knowledgeNodes,
      knowledgeTags,
    }));

    if (workspaceId && rootFolder) {
      const filesCacheKey = `${scopeId}:${rootFolder}`;
      if (!filesCacheRef.current.has(filesCacheKey)) {
        try {
          const result = await window.canvasWorkspace.file.listDir(rootFolder, 2);
          filesCacheRef.current.set(filesCacheKey, result.ok && result.entries
            ? flattenEntries(result.entries, rootFolder)
            : []);
        } catch {
          filesCacheRef.current.set(filesCacheKey, []);
        }
      }

      items.push(...(filesCacheRef.current.get(filesCacheKey) ?? []));
    }

    const normalizedQuery = query.toLowerCase();
    const filtered = normalizedQuery
      ? items.filter(item => item.label.toLowerCase().includes(normalizedQuery)
        || item.description?.toLowerCase().includes(normalizedQuery))
      : items;

    // Session search is query-only; the empty popup stays focused on context.
    if (normalizedQuery) {
      try {
        const result = await window.canvasWorkspace.agent.searchSessions(query, 5);
        if (result.ok && result.hits) {
          for (const hit of result.hits) {
            filtered.push({
              type: 'session',
              label: hit.preview || hit.date,
              sessionId: hit.sessionId,
              workspaceId: hit.workspaceId,
              description: `${hit.workspaceName} · ${hit.date}`,
            });
          }
        }
      } catch {
        // Session search is additive — ignore failures.
      }
    }

    return sortAndCapMentionItems(filtered);
  }, [allWorkspaces, describeTab, dockTabs, knowledgeNodes, knowledgeTags, loadSkillItems, nodes, rootFolder, scopeId, workspaceId]);

  const handleInput = useCallback(() => {
    const element = editableRef.current;
    if (!element) return;

    setInput(serializeEditable(element));

    // Every input event supersedes any in-flight popup build.
    const buildSeq = ++mentionBuildSeqRef.current;

    const selection = window.getSelection();
    if (
      !selection
      || !selection.rangeCount
      || !selection.anchorNode
      || selection.anchorNode.nodeType !== Node.TEXT_NODE
    ) {
      setMentionOpen(false);
      return;
    }

    const textBeforeCursor = (selection.anchorNode.textContent ?? '').slice(0, selection.anchorOffset);
    // Trigger on @ (mentions: workspaces/nodes/files) or / (skills). We pick
    // whichever marker is closer to the cursor so typing "/foo @bar" still
    // opens the @-popup once the user is past the slash query.
    const atMatch = textBeforeCursor.match(/@([^\s@/]*)$/);
    const slashMatch = textBeforeCursor.match(/(?:^|\s)\/([^\s@/]*)$/);
    const match = atMatch && slashMatch
      ? (atMatch.index! >= slashMatch.index! ? atMatch : slashMatch)
      : atMatch ?? slashMatch;

    if (!match) {
      setMentionOpen(false);
      return;
    }

    const trigger: '@' | '/' = match === atMatch ? '@' : '/';
    mentionTriggerRef.current = trigger;

    setMentionIndex(0);
    void buildMentionItems(match[1], trigger).then(items => {
      if (buildSeq !== mentionBuildSeqRef.current) return;
      setMentionItems(items);
      setMentionOpen(items.length > 0);
    });
  }, [buildMentionItems]);

  // Dismiss when focus moves outside the composer/popup.
  useEffect(() => {
    if (!mentionOpen) return;
    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (editableRef.current?.contains(target)) return;
      if (target.closest('.chat-mention-popup')) return;
      mentionBuildSeqRef.current++;
      setMentionOpen(false);
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [mentionOpen]);

  const selectMention = useCallback((item: MentionItem) => {
    const element = editableRef.current;
    if (!element) return;

    const selection = window.getSelection();
    if (!selection || !selection.rangeCount) return;

    const { anchorNode, anchorOffset } = selection;
    if (!anchorNode || anchorNode.nodeType !== Node.TEXT_NODE) return;

    const text = anchorNode.textContent ?? '';
    const before = text.slice(0, anchorOffset);
    const trigger = mentionTriggerRef.current;
    const triggerIndex = before.lastIndexOf(trigger);
    if (triggerIndex < 0) return;

    const beforeAt = text.slice(0, triggerIndex);
    const afterCursor = text.slice(anchorOffset);
    const chip = createMentionChipElement(item, nodes);
    const parent = anchorNode.parentNode;

    if (!parent) return;

    const fragment = document.createDocumentFragment();
    if (beforeAt) fragment.appendChild(document.createTextNode(beforeAt));
    fragment.appendChild(chip);

    const spaceNode = document.createTextNode(' ');
    fragment.appendChild(spaceNode);

    if (afterCursor) fragment.appendChild(document.createTextNode(afterCursor));
    parent.replaceChild(fragment, anchorNode);

    const range = document.createRange();
    range.setStartAfter(spaceNode);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);

    setInput(serializeEditable(element));
    mentionBuildSeqRef.current++;
    setMentionOpen(false);
    element.focus();
  }, [nodes]);

  const submitCurrentInput = useCallback(async (requestContext?: AgentRequestContext) => {
    if (isSubmitBlocked?.()) return false;
    if (attachmentsEnabled && chatAttachments.sendBlocked) return false;
    let ctx = requestContext ?? getRequestContext?.();
    // Tab mentions are collected for both hosts (see withCollectedTabs).
    if (editableRef.current) ctx = withCollectedTabs(editableRef.current, ctx);
    // Pull workspace-aware refs out of the inline @-mention chips (global host).
    if (collectStructuredContext && editableRef.current) {
      const collected = collectContextRefsFromEditable(editableRef.current);
      if (collected.nodes.length || collected.tags.length || collected.canvases.length || collected.domSelections.length) {
        ctx = {
          ...(ctx ?? {}),
          selectedNodes: [...(ctx?.selectedNodes ?? []), ...collected.nodes],
          tags: [...(ctx?.tags ?? []), ...collected.tags],
          canvases: [...(ctx?.canvases ?? []), ...collected.canvases],
          domSelections: [...(ctx?.domSelections ?? []), ...collected.domSelections],
          scope: 'selected_nodes',
        };
      }
    }
    const readyAttachments = attachmentsEnabled
      ? attachments.filter(attachment => (
        attachment.status === undefined || attachment.status === 'ready'
      ))
      : [];
    const ok = await onSubmit(input, ctx, readyAttachments);
    if (ok) {
      clearInput();
    }
    return ok;
  }, [attachments, attachmentsEnabled, chatAttachments.sendBlocked, clearInput, collectStructuredContext, getRequestContext, input, isSubmitBlocked, onSubmit]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    // While an IME composition is active (Chinese/Japanese/Korean input),
    // Enter confirms the candidate and arrows navigate the candidate list —
    // never send the message or move the mention selection.
    if (isImeComposing(event)) return;

    if (mentionOpen && mentionItems.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setMentionIndex(index => (index + 1) % mentionItems.length);
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setMentionIndex(index => (index - 1 + mentionItems.length) % mentionItems.length);
        return;
      }

      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        selectMention(mentionItems[mentionIndex]);
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        mentionBuildSeqRef.current++;
        setMentionOpen(false);
        return;
      }
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void submitCurrentInput();
    }
  }, [mentionIndex, mentionItems, mentionOpen, selectMention, submitCurrentInput]);

  const handlePaste = useCallback((event: React.ClipboardEvent) => {
    const imageFiles = Array.from(event.clipboardData.files).filter(file => file.type.startsWith('image/'));
    if (attachmentsEnabled && imageFiles.length > 0) {
      event.preventDefault();
      handleAttachFiles(imageFiles);
      return;
    }
    event.preventDefault();
    const text = event.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, text);
  }, [attachmentsEnabled, handleAttachFiles]);

  return {
    clearInput,
    attachments: attachmentsEnabled ? attachments : [],
    attachmentSendBlocked: attachmentsEnabled && chatAttachments.sendBlocked,
    editableRef,
    focusInput,
    handleAttachFiles,
    handleInput,
    handleKeyDown,
    handlePaste,
    input,
    insertDomSelectionMention,
    insertNodeMention,
    insertSkillMention,
    insertTabMention,
    mentionIndex,
    mentionItems,
    mentionOpen,
    removeAttachment: chatAttachments.removeAttachment,
    retryAttachment: chatAttachments.retryAttachment,
    replaceInput,
    selectMention,
    setMentionIndex,
    submitCurrentInput,
  };
}
