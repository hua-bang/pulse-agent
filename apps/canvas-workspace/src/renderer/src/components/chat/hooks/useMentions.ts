import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentContextDomSelectionRef, AgentRequestContext, CanvasNode, ChatImageAttachment, DirEntry } from '../../../types';
import { isImeComposing } from '../../../utils/ime';
import {
  MENTION_GROUP_ORDER,
  MENTION_MAX_ITEMS,
  getMentionGroupKey,
} from '../constants';
import type { MentionItem, WorkspaceOption } from '../types';
import type { AgentScope } from '../types';
import {
  collectContextRefsFromEditable,
  createMentionChipElement,
  serializeEditable,
} from '../utils/mentions';
import { appendMentionChipToEditable } from '../utils/editableMentions';
import { getNodeDisplayLabel } from '../../../utils/nodeLabel';
import { buildAttachmentFileName } from './attachmentFileName';

interface UseMentionsOptions {
  allWorkspaces?: WorkspaceOption[];
  agentScope: AgentScope;
  nodes?: CanvasNode[];
  rootFolder?: string;
  /** Cross-workspace knowledge nodes offered in the `@` popup (global host). */
  knowledgeNodes?: Array<{ id: string; title: string; type: CanvasNode['type']; workspaceId?: string }>;
  /** Knowledge tags offered in the `@` popup (global host). */
  knowledgeTags?: Array<{ id: string; name: string; workspaceIds?: string[] }>;
  /**
   * When true, structured context (with workspaceId) is collected from the
   * inline mention chips at send time and merged into the request context.
   * Enabled by the global Nodes/Graph assistant; off for the canvas panel.
   */
  collectStructuredContext?: boolean;
  onSubmit: (text: string, requestContext?: AgentRequestContext, attachments?: ChatImageAttachment[]) => Promise<boolean>;
  getRequestContext?: () => AgentRequestContext | undefined;
}

function flattenEntries(entries: DirEntry[], rootFolder: string, prefix = ''): MentionItem[] {
  const items: MentionItem[] = [];

  for (const entry of entries) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.type === 'file') {
      items.push({ type: 'file', label: path, path: `${rootFolder}/${path}` });
      continue;
    }

    // Directory: add it as a mention candidate, then recurse into children.
    items.push({ type: 'folder', label: `${path}/`, path: `${rootFolder}/${path}` });
    if (entry.children) {
      items.push(...flattenEntries(entry.children, rootFolder, path));
    }
  }

  return items;
}

export function useMentions({
  allWorkspaces,
  agentScope,
  nodes,
  rootFolder,
  knowledgeNodes,
  knowledgeTags,
  collectStructuredContext,
  onSubmit,
  getRequestContext,
}: UseMentionsOptions) {
  const [input, setInput] = useState('');
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionItems, setMentionItems] = useState<MentionItem[]>([]);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [attachments, setAttachments] = useState<ChatImageAttachment[]>([]);
  const editableRef = useRef<HTMLDivElement>(null);
  const filesCacheRef = useRef<MentionItem[] | null>(null);
  const skillsCacheRef = useRef<MentionItem[] | null>(null);
  const workspaceId = agentScope.kind === 'workspace' ? agentScope.workspaceId : undefined;
  /**
   * Which trigger char opened the popup — '@' lists workspaces/nodes/files,
   * '/' lists skills. Captured at popup-open time so selectMention knows
   * which prefix to strip when it splices the chip in.
   */
  const mentionTriggerRef = useRef<'@' | '/'>('@');
  /**
   * Monotonic id of the latest popup build. buildMentionItems is async (file
   * listing, session search), so when the user types quickly an older, slower
   * build can resolve after a newer one — or after the popup was dismissed —
   * and must not apply its stale items / reopen the popup.
   */
  const mentionBuildSeqRef = useRef(0);

  const insertNodeMention = useCallback((node: CanvasNode) => {
    const element = editableRef.current;
    if (!element) return;

    const item: MentionItem = {
      type: 'node',
      nodeId: node.id,
      label: getNodeDisplayLabel(node),
      nodeType: node.type,
      path: (node.data as any)?.filePath,
    };
    const chip = createMentionChipElement(item, nodes);

    appendMentionChipToEditable(element, chip);
    setInput(serializeEditable(element));
    element.focus();
  }, [nodes]);

  const insertDomSelectionMention = useCallback((domSelection: AgentContextDomSelectionRef) => {
    const element = editableRef.current;
    if (!element) return;

    const item: MentionItem = {
      type: 'dom',
      label: domSelection.label,
      nodeType: 'iframe',
      domSelection,
    };
    const chip = createMentionChipElement(item, nodes);

    appendMentionChipToEditable(element, chip);
    setInput(serializeEditable(element));
    element.focus();
  }, [nodes]);

  const clearInput = useCallback(() => {
    setInput('');
    mentionBuildSeqRef.current++;
    setMentionOpen(false);
    setMentionItems([]);
    setMentionIndex(0);
    setAttachments([]);
    if (editableRef.current) {
      editableRef.current.innerHTML = '';
    }
  }, []);

  const focusInput = useCallback(() => {
    editableRef.current?.focus();
  }, []);

  const loadSkillItems = useCallback(async (): Promise<MentionItem[]> => {
    if (skillsCacheRef.current) return skillsCacheRef.current;
    try {
      const result = await window.canvasWorkspace.agent.listSkills({ scope: agentScope });
      skillsCacheRef.current = result.ok && result.skills
        ? result.skills.map(s => ({ type: 'skill', label: s.name, description: s.description }))
        : [];
    } catch {
      skillsCacheRef.current = [];
    }
    return skillsCacheRef.current;
  }, [agentScope]);

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

    if (allWorkspaces) {
      for (const workspace of allWorkspaces) {
        if (workspace.id === workspaceId) continue;
        items.push({ type: 'workspace', label: workspace.name, workspaceId: workspace.id });
      }
    }

    if (workspaceId && nodes) {
      for (const node of nodes) {
        items.push({
          type: 'node',
          nodeId: node.id,
          label: getNodeDisplayLabel(node),
          nodeType: node.type,
          path: (node.data as any)?.filePath,
        });
      }
    }

    // Cross-workspace knowledge candidates (global Nodes/Graph assistant). Each
    // node carries its workspaceId; each tag the workspaces it occurs in, so the
    // structured context collected at send time resolves precisely.
    if (knowledgeNodes) {
      for (const node of knowledgeNodes) {
        items.push({ type: 'node', nodeId: node.id, label: node.title, nodeType: node.type, workspaceId: node.workspaceId });
      }
    }
    if (knowledgeTags) {
      for (const tag of knowledgeTags) {
        items.push({ type: 'tag', label: tag.name, workspaceIds: tag.workspaceIds });
      }
    }

    if (workspaceId && rootFolder) {
      if (!filesCacheRef.current) {
        try {
          const result = await window.canvasWorkspace.file.listDir(rootFolder, 2);
          filesCacheRef.current = result.ok && result.entries
            ? flattenEntries(result.entries, rootFolder)
            : [];
        } catch {
          filesCacheRef.current = [];
        }
      }

      if (filesCacheRef.current) {
        items.push(...filesCacheRef.current);
      }
    }

    const normalizedQuery = query.toLowerCase();
    const filtered = normalizedQuery
      ? items.filter(item => item.label.toLowerCase().includes(normalizedQuery))
      : items;

    // Past chat sessions, matched by TITLE (first user message + workspace
    // name) — deliberately not message content, to keep the per-keystroke
    // cost low. Only surfaced when the user typed a query — the default
    // (empty) popup stays nodes/files/canvases only.
    if (normalizedQuery) {
      try {
        const result = await window.canvasWorkspace.agent.searchSessions(query, 5);
        if (result.ok && result.hits) {
          for (const hit of result.hits) {
            filtered.push({
              type: 'session',
              label: `${hit.workspaceName} · ${hit.date}`,
              sessionId: hit.sessionId,
              workspaceId: hit.workspaceId,
              description: hit.preview,
            });
          }
        }
      } catch {
        // Session search is additive — ignore failures.
      }
    }

    filtered.sort((left, right) => {
      const leftOrder = MENTION_GROUP_ORDER.indexOf(getMentionGroupKey(left));
      const rightOrder = MENTION_GROUP_ORDER.indexOf(getMentionGroupKey(right));
      return leftOrder - rightOrder;
    });

    return filtered.slice(0, MENTION_MAX_ITEMS);
  }, [allWorkspaces, knowledgeNodes, knowledgeTags, loadSkillItems, nodes, rootFolder, workspaceId]);

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

  // Dismiss the mention popup when the user clicks anywhere outside the
  // composer or the popup itself — otherwise it lingers until Escape or a
  // selection, which reads as stuck.
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
    let ctx = requestContext ?? getRequestContext?.();
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
    const ok = await onSubmit(input, ctx, attachments);
    if (ok) {
      clearInput();
    }
    return ok;
  }, [attachments, clearInput, collectStructuredContext, getRequestContext, input, onSubmit]);

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

  const attachImageFile = useCallback(async (file: File) => {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.onerror = () => reject(reader.error ?? new Error('Failed to read image file'));
      reader.readAsDataURL(file);
    });
    const base64 = dataUrl.split(',')[1];
    if (!base64) return;
    const ext = file.type.replace('image/', '').split(';')[0] || 'png';
    const saved = await window.canvasWorkspace.file.saveImage(workspaceId ?? '__global_chat__', base64, ext);
    if (!saved.ok || !saved.filePath) return;
    setAttachments(prev => [
      ...prev,
      {
        id: `attachment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        path: saved.filePath!,
        fileName: buildAttachmentFileName(file, ext),
        mimeType: file.type || `image/${ext}`,
      },
    ]);
  }, [workspaceId]);

  const removeAttachment = useCallback((id: string) => {
    setAttachments(prev => prev.filter(item => item.id !== id));
  }, []);

  const handleAttachFiles = useCallback((files: FileList | File[]) => {
    const imageFiles = Array.from(files).filter(file => file.type.startsWith('image/'));
    for (const file of imageFiles) {
      void attachImageFile(file);
    }
  }, [attachImageFile]);

  const handlePaste = useCallback((event: React.ClipboardEvent) => {
    const imageFiles = Array.from(event.clipboardData.files).filter(file => file.type.startsWith('image/'));
    if (imageFiles.length > 0) {
      event.preventDefault();
      handleAttachFiles(imageFiles);
      return;
    }
    event.preventDefault();
    const text = event.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, text);
  }, [handleAttachFiles]);

  return {
    clearInput,
    attachments,
    editableRef,
    focusInput,
    handleAttachFiles,
    handleInput,
    handleKeyDown,
    handlePaste,
    input,
    insertDomSelectionMention,
    insertNodeMention,
    mentionIndex,
    mentionItems,
    mentionOpen,
    removeAttachment,
    selectMention,
    setMentionIndex,
    submitCurrentInput,
  };
}
