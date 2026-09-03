import { useCallback, useRef, useState, type RefObject } from 'react';
import type {
  AgentRequestContext,
  ChatImageAttachment,
  ChatRunInputMode,
} from '../../../../types';
import { collectContextRefsFromEditable, withCollectedTabs } from '../utils/mentions';
import { withCollectedPlugins } from '../../mentions/pluginMentionItems';

interface Options {
  attachments: ChatImageAttachment[];
  attachmentSendBlocked: boolean;
  clearInput: () => void;
  collectStructuredContext?: boolean;
  editableRef: RefObject<HTMLDivElement>;
  getRequestContext?: () => AgentRequestContext | undefined;
  input: string;
  isSubmitBlocked?: () => boolean;
  onSubmit: (
    text: string,
    requestContext?: AgentRequestContext,
    attachments?: ChatImageAttachment[],
  ) => Promise<boolean>;
  onSubmitDuringRun?: (
    mode: ChatRunInputMode,
    text: string,
    requestContext?: AgentRequestContext,
  ) => Promise<boolean>;
}

export const useChatComposerSubmission = ({
  attachments,
  attachmentSendBlocked,
  clearInput,
  collectStructuredContext,
  editableRef,
  getRequestContext,
  input,
  isSubmitBlocked,
  onSubmit,
  onSubmitDuringRun,
}: Options) => {
  const [runInputSubmitting, setRunInputSubmitting] = useState(false);
  const runInputSubmittingRef = useRef(false);

  const collectRequestContext = useCallback((requestContext?: AgentRequestContext) => {
    let context = requestContext ?? getRequestContext?.();
    if (editableRef.current) context = withCollectedTabs(editableRef.current, context);
    if (editableRef.current) context = withCollectedPlugins(editableRef.current, context);
    if (collectStructuredContext && editableRef.current) {
      const collected = collectContextRefsFromEditable(editableRef.current);
      if (collected.nodes.length || collected.tags.length || collected.canvases.length || collected.domSelections.length) {
        context = {
          ...(context ?? {}),
          selectedNodes: [...(context?.selectedNodes ?? []), ...collected.nodes],
          tags: [...(context?.tags ?? []), ...collected.tags],
          canvases: [...(context?.canvases ?? []), ...collected.canvases],
          domSelections: [...(context?.domSelections ?? []), ...collected.domSelections],
          scope: 'selected_nodes',
        };
      }
    }
    return context;
  }, [collectStructuredContext, editableRef, getRequestContext]);

  const submitCurrentInput = useCallback(async (requestContext?: AgentRequestContext) => {
    if (isSubmitBlocked?.() || attachmentSendBlocked) return false;
    const readyAttachments = attachments.filter(attachment => (
      attachment.status === undefined || attachment.status === 'ready'
    ));
    const accepted = await onSubmit(input, collectRequestContext(requestContext), readyAttachments);
    if (accepted) clearInput();
    return accepted;
  }, [attachmentSendBlocked, attachments, clearInput, collectRequestContext, input, isSubmitBlocked, onSubmit]);

  const submitCurrentInputDuringRun = useCallback(async (mode: ChatRunInputMode) => {
    if (!onSubmitDuringRun || runInputSubmittingRef.current || attachmentSendBlocked || attachments.length > 0) return false;
    runInputSubmittingRef.current = true;
    setRunInputSubmitting(true);
    try {
      const accepted = await onSubmitDuringRun(mode, input, collectRequestContext());
      if (accepted) clearInput();
      return accepted;
    } finally {
      runInputSubmittingRef.current = false;
      setRunInputSubmitting(false);
    }
  }, [attachmentSendBlocked, attachments.length, clearInput, collectRequestContext, input, onSubmitDuringRun]);

  return { runInputSubmitting, submitCurrentInput, submitCurrentInputDuringRun };
};
