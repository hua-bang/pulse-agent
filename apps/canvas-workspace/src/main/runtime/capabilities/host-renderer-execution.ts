import { getRuntimeWindowPort } from '../window-port';
import {
  evalInPage,
  type PageRunner,
} from '../../../plugins/main/webview-page-control/js-primitives';
import { CapabilityError, type CapabilityContext } from './types';
import type { HostRendererEvalInput } from './host-renderer-capabilities';

const DEFAULT_TIMEOUT_MS = 5_000;
const WORKSPACE_MANIFEST_ID = '__workspaces__';
const HOST_RENDERER_CONTEXT_SCRIPT = `
(async function () {
  var hashLocation = window.location.hash.replace(/^#/, '') || '/';
  var routePath = hashLocation.split('?')[0] || '/';
  if (routePath !== '/') return { routePath: routePath, workspaceId: null };

  var store = window.canvasWorkspace && window.canvasWorkspace.store;
  if (!store || typeof store.load !== 'function') {
    return { routePath: routePath, workspaceId: null };
  }
  var result = await store.load('${WORKSPACE_MANIFEST_ID}');
  var workspaceId = result && result.ok && result.data
    && typeof result.data.activeId === 'string'
    ? result.data.activeId
    : null;
  return { routePath: routePath, workspaceId: workspaceId };
})()
`;

interface HostRendererContext {
  routePath: string;
  workspaceId: string | null;
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
  const runner = getRuntimeWindowPort().getCanvasWindow()?.webContents;
  if (!runner) {
    throw new CapabilityError('host_renderer_unavailable', 'Canvas renderer is unavailable');
  }

  const rendererContext = await readHostRendererContext(runner);
  if (rendererContext.routePath !== '/') {
    throw new CapabilityError(
      'host_renderer_unavailable',
      `Canvas renderer is showing route ${rendererContext.routePath}, not workspace ${context.workspaceId}.`,
    );
  }
  if (rendererContext.workspaceId !== context.workspaceId) {
    throw new CapabilityError(
      'host_renderer_unavailable',
      `Canvas renderer is showing workspace ${rendererContext.workspaceId ?? 'unknown'}, not ${context.workspaceId}.`,
    );
  }

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

async function readHostRendererContext(runner: PageRunner): Promise<HostRendererContext> {
  let value: unknown;
  try {
    value = await runner.executeJavaScript(HOST_RENDERER_CONTEXT_SCRIPT);
  } catch (error) {
    throw new CapabilityError(
      'host_renderer_unavailable',
      `Canvas renderer context could not be read: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!value || typeof value !== 'object') {
    throw new CapabilityError('host_renderer_unavailable', 'Canvas renderer context is unavailable');
  }
  const context = value as Partial<HostRendererContext>;
  if (typeof context.routePath !== 'string') {
    throw new CapabilityError('host_renderer_unavailable', 'Canvas renderer route is unavailable');
  }
  return {
    routePath: context.routePath,
    workspaceId: typeof context.workspaceId === 'string' ? context.workspaceId : null,
  };
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
