import { useCallback, useRef, useState } from 'react';
import type { AgentRequestContext, CanvasNode, ChatImageAttachment, DirEntry } from '../../../types';
import {
  MENTION_GROUP_ORDER,
  MENTION_MAX_ITEMS,
  getMentionGroupKey,
} from '../constants';
import type { MentionItem, WorkspaceOption } from '../types';
import {
  createMentionChipElement,
  serializeEditable,
} from '../utils/mentions';
import { getNodeDisplayLabel } from '../../../utils/nodeLabel';

interface UseMentionsOptions {
  allWorkspaces?: WorkspaceOption[];
  workspaceId: string;
  nodes?: CanvasNode[];
  rootFolder?: string;
  onSubmit: (text: string, requestContext?: AgentRequestContext, attachments?: ChatImageAttachment[]) => Promise<boolean>;
  getRequestContext?: () => AgentRequestContext | undefined;
}

function flattenEntries(entries: DirEntry[], rootFolder: string, prefix = ''): MentionItem[] {
  const files: MentionItem[] = [];

  for (const entry of entries) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.type === 'file') {
      files.push({ type: 'file', label: path, path: `${rootFolder}/${path}` });
      continue;
    }

    if (entry.children) {
      files.push(...flattenEntries(entry.children, rootFolder, path));
    }
  }

  return files;
}

export function useMentions({
  allWorkspaces,
  workspaceId,
  nodes,
  rootFolder,
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

  const clearInput = useCallback(() => {
    setInput('');
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

  const buildMentionItems = useCallback(async (query: string) => {
    const items: MentionItem[] = [];

    if (allWorkspaces) {
      for (const workspace of allWorkspaces) {
        if (workspace.id === workspaceId) continue;
        items.push({ type: 'workspace', label: workspace.name, workspaceId: workspace.id });
      }
    }

    if (nodes) {
      for (const node of nodes) {
        items.push({
          type: 'node',
          label: getNodeDisplayLabel(node),
          nodeType: node.type,
          path: (node.data as any)?.filePath,
        });
      }
    }

    if (rootFolder) {
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

    filtered.sort((left, right) => {
      const leftOrder = MENTION_GROUP_ORDER.indexOf(getMentionGroupKey(left));
      const rightOrder = MENTION_GROUP_ORDER.indexOf(getMentionGroupKey(right));
      return leftOrder - rightOrder;
    });

    return filtered.slice(0, MENTION_MAX_ITEMS);
  }, [allWorkspaces, nodes, rootFolder, workspaceId]);

  const handleInput = useCallback(() => {
    const element = editableRef.current;
    if (!element) return;

    setInput(serializeEditable(element));

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
    const atMatch = textBeforeCursor.match(/@([^\s@]*)$/);

    if (!atMatch) {
      setMentionOpen(false);
      return;
    }

    setMentionIndex(0);
    void buildMentionItems(atMatch[1]).then(items => {
      setMentionItems(items);
      setMentionOpen(items.length > 0);
    });
  }, [buildMentionItems]);

  const selectMention = useCallback((item: MentionItem) => {
    const element = editableRef.current;
    if (!element) return;

    const selection = window.getSelection();
    if (!selection || !selection.rangeCount) return;

    const { anchorNode, anchorOffset } = selection;
    if (!anchorNode || anchorNode.nodeType !== Node.TEXT_NODE) return;

    const text = anchorNode.textContent ?? '';
    const before = text.slice(0, anchorOffset);
    const atIndex = before.lastIndexOf('@');
    if (atIndex < 0) return;

    const beforeAt = text.slice(0, atIndex);
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
    setMentionOpen(false);
    element.focus();
  }, [nodes]);

  const submitCurrentInput = useCallback(async (requestContext?: AgentRequestContext) => {
    const ok = await onSubmit(input, requestContext ?? getRequestContext?.(), attachments);
    if (ok) {
      clearInput();
    }
    return ok;
  }, [attachments, clearInput, getRequestContext, input, onSubmit]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
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
    const saved = await window.canvasWorkspace.file.saveImage(workspaceId, base64, ext);
    if (!saved.ok || !saved.filePath) return;
    setAttachments(prev => [
      ...prev,
      {
        id: `attachment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        path: saved.filePath!,
        fileName: file.name || saved.fileName,
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
    mentionIndex,
    mentionItems,
    mentionOpen,
    removeAttachment,
    selectMention,
    setMentionIndex,
    submitCurrentInput,
  };
}
