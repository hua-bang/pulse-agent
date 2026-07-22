import { randomUUID } from 'crypto';

import {
  CANVAS_AGENT_EXTERNAL_CHAT_REQUEST_EVENT,
  CANVAS_AGENT_EXTERNAL_CHAT_RESULT_EVENT,
} from '../../../shared/agent-chat';
import { evalInPage } from '../../../plugins/main/webview-page-control/js-primitives';
import { CapabilityError, type CapabilityContext } from './types';
import type { CanvasAgentChatInput } from './chat-capabilities';
import { resolveHostRenderer } from './host-renderer-execution';

const DISPATCH_TIMEOUT_MS = 5_000;
const RETRY_INTERVAL_MS = 50;

function scriptLiteral(value: unknown): string {
  const lineSeparator = String.fromCharCode(0x2028);
  const paragraphSeparator = String.fromCharCode(0x2029);
  return JSON.stringify(value)
    .split(lineSeparator).join('\\u2028')
    .split(paragraphSeparator).join('\\u2029');
}

export function buildExternalChatScript(
  input: CanvasAgentChatInput,
  requestId: string,
  workspaceId: string,
): string {
  const request = scriptLiteral({ requestId, workspaceId, message: input.message, sender: input.sender });
  return `return new Promise(function(resolve) {
  var request = ${request};
  var retry = null;
  var timeout = null;
  function cleanup() {
    if (retry !== null) window.clearInterval(retry);
    if (timeout !== null) window.clearTimeout(timeout);
    window.removeEventListener(${scriptLiteral(CANVAS_AGENT_EXTERNAL_CHAT_RESULT_EVENT)}, onResult);
  }
  function finish(value) { cleanup(); resolve(value); }
  function onResult(event) {
    var detail = event && event.detail;
    if (!detail || detail.requestId !== request.requestId) return;
    finish({ accepted: detail.accepted === true });
  }
  function dispatch() {
    window.dispatchEvent(new CustomEvent(${scriptLiteral(CANVAS_AGENT_EXTERNAL_CHAT_REQUEST_EVENT)}, { detail: request }));
  }
  window.addEventListener(${scriptLiteral(CANVAS_AGENT_EXTERNAL_CHAT_RESULT_EVENT)}, onResult);
  dispatch();
  retry = window.setInterval(dispatch, ${RETRY_INTERVAL_MS});
  timeout = window.setTimeout(function() {
    finish({ accepted: false, error: 'chat_handler_unavailable' });
  }, ${DISPATCH_TIMEOUT_MS});
})`;
}

export async function executeExternalChat(
  input: CanvasAgentChatInput,
  context: CapabilityContext,
): Promise<{ accepted: true }> {
  const runner = await resolveHostRenderer(context.workspaceId);
  const result = await withAbort(
    evalInPage(
      runner,
      buildExternalChatScript(input, randomUUID(), context.workspaceId),
      DISPATCH_TIMEOUT_MS + 1_000,
    ),
    context.abortSignal,
  );
  if (!result.ok) {
    throw new CapabilityError(
      result.timedOut ? 'chat_unavailable' : 'chat_dispatch_failed',
      result.error ?? 'Canvas Agent chat could not receive the message.',
    );
  }
  const value = result.data?.value;
  if (!value || typeof value !== 'object' || (value as { accepted?: unknown }).accepted !== true) {
    throw new CapabilityError('chat_unavailable', 'Canvas Agent chat is not ready to receive messages.');
  }
  return { accepted: true };
}

async function withAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) throw new CapabilityError('aborted', 'Capability call was aborted');
  return await new Promise<T>((resolve, reject) => {
    const abort = () => reject(new CapabilityError('aborted', 'Capability call was aborted'));
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
