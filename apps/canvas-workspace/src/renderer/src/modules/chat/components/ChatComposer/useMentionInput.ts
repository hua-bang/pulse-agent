import { useCallback, useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import type { AgentScope, CanvasNode, WorkspaceOption } from '../../../../types';
import { scopeSessionStoreId } from '../../../../../../shared/agent-chat';
import { isImeComposing } from '../../../../utils/ime';
import { serializeEditable } from '../../mentions/mentions';
import { collectEditableContext } from '../../mentions/editableContext';
import { insertPlainText } from '../../mentions/insertPlainText';
import { useMentionItems } from './useMentionItems';
import { useMentionPopup } from './useMentionPopup';

interface Options {
  agentScope: AgentScope;
  allWorkspaces?: WorkspaceOption[];
  /** The scoped workspace's nodes, offered as `@` node mentions. */
  nodes?: CanvasNode[];
  /** Enter without Shift, outside the popup. */
  onSubmit: () => void;
}

/**
 * A standalone contentEditable field with the chat composer's `@` and `/`
 * mentions, for surfaces outside a chat such as the launcher. It keeps its
 * own text: no shared draft, attachments, or run queue.
 */
export const useMentionInput = ({ agentScope, allWorkspaces, nodes, onSubmit }: Options) => {
  const editableRef = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState('');
  const scopeId = scopeSessionStoreId(agentScope);
  const { buildMentionItems, searchSessionMentionItems } = useMentionItems({
    agentScope,
    allWorkspaces,
    nodes,
    scopeId,
    workspaceId: agentScope.kind === 'workspace' ? agentScope.workspaceId : undefined,
  });
  const popup = useMentionPopup({ editableRef, setInput, nodes, buildMentionItems, searchSessionMentionItems });
  const { detectMention, handleMentionKeyDown, resetMention } = popup;

  // Rows built for the old scope would mention the wrong workspace's nodes.
  useEffect(() => {
    resetMention();
  }, [resetMention, scopeId]);

  const handleInput = useCallback(() => {
    const element = editableRef.current;
    if (!element) return;
    setInput(serializeEditable(element));
    detectMention();
  }, [detectMention]);

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    // Enter confirms an IME candidate; it never sends or picks a mention.
    if (isImeComposing(event)) return;
    if (handleMentionKeyDown(event)) return;
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      onSubmit();
    }
  }, [handleMentionKeyDown, onSubmit]);

  // Paste plain text, so pasted markup never lands in the field.
  const handlePaste = useCallback((event: ClipboardEvent<HTMLDivElement>) => {
    event.preventDefault();
    insertPlainText(event.clipboardData.getData('text/plain'));
  }, []);

  /** Puts `text` in the field with the caret at its end. */
  const replaceInput = useCallback((text: string) => {
    resetMention();
    setInput(text);
    const element = editableRef.current;
    if (!element) return;
    element.textContent = text;
    element.focus();
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, [resetMention]);

  /** What the field's chips point at, as request context for the turn. */
  const collectContext = useCallback(
    () => collectEditableContext(editableRef.current, undefined, true),
    [],
  );

  return {
    ...popup,
    collectContext,
    editableRef,
    handleInput,
    handleKeyDown,
    handlePaste,
    input,
    replaceInput,
  };
};
