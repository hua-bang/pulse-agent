import { stat } from 'fs/promises';
import type { WebContents } from 'electron';
import type { AgentScope } from './types';
import type { CanvasAgentService } from './service';
import { ActiveChatRegistry } from './active-chat-registry';
import {
  freezePreparedChatModel,
  PreparedChatRegistry,
  startPreparedChat,
  type PreparedChatPayload,
} from './prepared-chat';
import { resolveCanvasModel } from './model/config';
import type { ChatRunInputMode } from '../../shared/agent-chat';
import { resolveAgentRuntime } from './backends';
import { parseRoleMentions } from '../../shared/agent-roles';

const MAX_ATTACHMENT_COUNT = 6;
const MAX_ATTACHMENT_BYTES = 12 * 1024 * 1024;
const MAX_TOTAL_ATTACHMENT_BYTES = 30 * 1024 * 1024;

type ProtocolFailure = {
  ok: false;
  code?: string;
  error: string;
};

interface ChatRunInputService {
  submitRunInput(
    runId: string,
    scope: AgentScope,
    mode: ChatRunInputMode,
    text: string,
  ): Promise<{ ok: boolean; code?: string; error?: string }>;
}

export async function submitChatRunInput(opts: {
  sessionId: string;
  text: string;
  mode: ChatRunInputMode;
  activeChats: ActiveChatRegistry;
  service: ChatRunInputService;
}) {
  const text = opts.text.trim();
  if (!text) return { ok: false as const, code: 'CHAT_INPUT_EMPTY', error: 'Message is required' };
  if (opts.mode !== 'steer' && opts.mode !== 'follow-up') {
    return { ok: false as const, code: 'CHAT_INPUT_MODE_INVALID', error: 'Unknown run input mode' };
  }
  const scope = opts.activeChats.scopeOf(opts.sessionId);
  if (!scope) {
    return {
      ok: false as const,
      code: 'CHAT_RUN_NOT_ACTIVE',
      error: 'The chat run is no longer active.',
    };
  }
  return opts.service.submitRunInput(opts.sessionId, scope, opts.mode, text);
}

export async function validatePreparedChatPayload(
  payload: PreparedChatPayload,
): Promise<ProtocolFailure | null> {
  const attachments = payload.attachments ?? [];
  if (!payload.message?.trim() && attachments.length === 0) {
    return { ok: false, error: 'Message or attachment is required' };
  }
  if (attachments.length > MAX_ATTACHMENT_COUNT) {
    return {
      ok: false,
      code: 'ATTACHMENT_LIMIT',
      error: `A chat turn can include at most ${MAX_ATTACHMENT_COUNT} images.`,
    };
  }

  let totalBytes = 0;
  for (const attachment of attachments) {
    if (!attachment.path) {
      return { ok: false, code: 'ATTACHMENT_INVALID', error: 'Attachment path is required.' };
    }
    let size: number;
    try {
      size = (await stat(attachment.path)).size;
    } catch {
      return {
        ok: false,
        code: 'ATTACHMENT_INVALID',
        error: `Attachment is unavailable: ${attachment.fileName ?? attachment.id}`,
      };
    }
    if (size > MAX_ATTACHMENT_BYTES) {
      return {
        ok: false,
        code: 'ATTACHMENT_LIMIT',
        error: 'Each image must be 12 MB or smaller.',
      };
    }
    totalBytes += size;
    if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
      return {
        ok: false,
        code: 'ATTACHMENT_LIMIT',
        error: 'Attachments must total 30 MB or less.',
      };
    }
  }
  return null;
}

export async function prepareChatTurn(opts: {
  sender: WebContents;
  scope: AgentScope;
  payload: PreparedChatPayload;
  activeChats: ActiveChatRegistry;
  preparedChats: PreparedChatRegistry;
}) {
  const invalid = await validatePreparedChatPayload(opts.payload);
  if (invalid) return invalid;
  const turn = opts.preparedChats.prepare(
    opts.sender,
    opts.scope,
    opts.payload,
    expired => opts.activeChats.releaseReservation(expired.sessionId),
  );
  if (!opts.activeChats.reserve(turn.sessionId, turn.scope)) {
    opts.preparedChats.discard(turn.sessionId);
    return {
      ok: false as const,
      code: 'CHAT_SCOPE_BUSY',
      error: 'Another reply is already running for this chat scope.',
    };
  }
  return { ok: true as const, sessionId: turn.sessionId };
}

export async function startChatTurn(opts: {
  sender: WebContents;
  sessionId: string;
  service: CanvasAgentService;
  activeChats: ActiveChatRegistry;
  preparedChats: PreparedChatRegistry;
}) {
  const turn = opts.preparedChats.take(opts.sessionId, opts.sender);
  if (!turn) {
    return { ok: false as const, error: 'Prepared chat expired or belongs to another window' };
  }
  const abortSignal = opts.activeChats.startReserved(turn.sessionId);
  if (!abortSignal) {
    opts.activeChats.settle(turn.sessionId);
    return { ok: false as const, error: 'Prepared chat reservation expired' };
  }
  try {
    const modelConfig = await resolveCanvasModel();
    const resolution = freezePreparedChatModel(turn, modelConfig);
    const runtime = resolveAgentRuntime(null);
    startPreparedChat(
      opts.service,
      turn,
      abortSignal,
      () => opts.activeChats.settle(turn.sessionId),
      modelConfig,
    );
    const runInputModes: ChatRunInputMode[] = runtime.capabilities.steering === 'native'
      && parseRoleMentions(turn.payload.message).length === 0
      ? ['steer', 'follow-up']
      : [];
    return { ok: true as const, ...resolution, runInputModes };
  } catch (error) {
    opts.activeChats.settle(turn.sessionId);
    return { ok: false as const, error: String(error) };
  }
}
