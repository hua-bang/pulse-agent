import type { ServerResponse } from 'http';
import { getExperimentalFlagSync } from '../settings/experimental-ipc';
import { EXPERIMENTAL_FLAG_AGENT_RUNTIME_CONTROL } from '../../shared/experimental-features';
import { getCanvasCapabilityRuntime } from './capabilities';
import { replyJson } from './http-utils';

/**
 * Handles the experimental capability endpoints when the URL belongs to this
 * adapter. Returning false lets the runtime-control server continue routing
 * its stable agent/team endpoints.
 */
export async function handleCapabilityHttpRequest(
  url: string | undefined,
  res: ServerResponse,
  body: Record<string, unknown>,
): Promise<boolean> {
  if (url !== '/capabilities/list' && url !== '/capabilities/call') {
    return false;
  }

  if (!getExperimentalFlagSync(EXPERIMENTAL_FLAG_AGENT_RUNTIME_CONTROL)) {
    replyJson(res, 404, { ok: false, error: 'not found' });
    return true;
  }

  if (url === '/capabilities/list') {
    replyJson(res, 200, {
      ok: true,
      capabilities: getCanvasCapabilityRuntime().list({ kind: 'pulse-cli' }),
    });
    return true;
  }

  const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId : '';
  const name = typeof body.name === 'string' ? body.name : '';
  if (!name) {
    replyJson(res, 400, { ok: false, error: 'name is required' });
    return true;
  }

  const result = await getCanvasCapabilityRuntime().call(name, body.input ?? {}, {
    workspaceId,
    actor: { kind: 'pulse-cli' },
  });
  if (result.ok) {
    console.info(`[capability-runtime] actor=pulse-cli capability=${name} workspace=${workspaceId} ok=true`);
    replyJson(res, 200, result);
    return true;
  }

  const status = result.error.code === 'capability_not_found'
    ? 404
    : result.error.code === 'capability_forbidden'
      ? 403
    : result.error.code === 'invalid_input' || result.error.code === 'invalid_context'
      ? 400
      : 409;
  console.info(
    `[capability-runtime] actor=pulse-cli capability=${name} workspace=${workspaceId || '(missing)'} ok=false code=${result.error.code}`,
  );
  replyJson(res, status, result);
  return true;
}
