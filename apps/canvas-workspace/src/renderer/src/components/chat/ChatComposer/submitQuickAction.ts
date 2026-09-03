import type {
  AgentRequestContext,
  ChatImageAttachment,
} from '../../../types';

interface SubmitQuickActionOptions {
  prompt: string;
  quickAction?: string;
  requestContext?: AgentRequestContext;
  attachments: ChatImageAttachment[];
  sendMessage: (
    text: string,
    requestContext?: AgentRequestContext,
    attachments?: ChatImageAttachment[],
  ) => Promise<boolean>;
  clearInput: () => void;
}

export async function submitQuickAction({
  prompt,
  quickAction,
  requestContext,
  attachments,
  sendMessage,
  clearInput,
}: SubmitQuickActionOptions): Promise<boolean> {
  const context = quickAction
    ? { ...requestContext, quickAction }
    : requestContext;
  const sent = await sendMessage(prompt, context, attachments);
  if (sent) clearInput();
  return sent;
}
