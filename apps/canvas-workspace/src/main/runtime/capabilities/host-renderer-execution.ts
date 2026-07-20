import { activateWorkspaceWindow } from '../../app/window-manager';
import { getPublishedDockWorkspaceId } from '../../dock/tab-store';
import { evalInPage } from '../../../plugins/main/webview-page-control/js-primitives';
import { CapabilityError, type CapabilityContext } from './types';
import type { HostRendererEvalInput } from './host-renderer-capabilities';

const DEFAULT_TIMEOUT_MS = 5_000;

export interface HostRendererRunner {
  id: number;
  executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>;
}

export async function executeHostRendererEval(
  input: HostRendererEvalInput,
  context: CapabilityContext,
): Promise<unknown> {
  try {
    const value = await execute(input, context);
    audit(context, true);
    return value;
  } catch (error) {
    audit(context, false);
    throw error;
  }
}

async function execute(input: HostRendererEvalInput, context: CapabilityContext): Promise<unknown> {
  const runner = await resolveHostRenderer(context.workspaceId);
  const execution = evalInPage(runner, input.code, input.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const result = await withAbort(execution, context.abortSignal);
  if (!result.ok) {
    throw new CapabilityError(
      result.timedOut ? 'host_renderer_timeout' : 'host_renderer_eval_failed',
      result.error ?? 'Host renderer script failed',
      { timedOut: result.timedOut === true },
    );
  }
  return { action: 'host_renderer_eval', ...result.data };
}

export async function resolveHostRenderer(workspaceId: string): Promise<HostRendererRunner> {
  const activation = await activateWorkspaceWindow(workspaceId);
  if (!activation.ok) {
    throw new CapabilityError(
      'host_renderer_unavailable',
      activation.error ?? 'Canvas window is unavailable',
    );
  }
  const runner = activation.window?.webContents;
  if (!runner) {
    throw new CapabilityError('host_renderer_unavailable', 'Canvas renderer is unavailable');
  }

  const deadline = Date.now() + 3_000;
  while (
    getPublishedDockWorkspaceId(runner.id) !== workspaceId
    && Date.now() < deadline
  ) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  if (getPublishedDockWorkspaceId(runner.id) !== workspaceId) {
    throw new CapabilityError(
      'host_renderer_unavailable',
      `Canvas renderer did not activate workspace ${workspaceId}.`,
    );
  }
  return runner;
}

function audit(context: CapabilityContext, ok: boolean): void {
  console.info(
    `[host-renderer-eval] actor=${context.actor.kind} workspace=${context.workspaceId} ok=${ok}`,
  );
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
