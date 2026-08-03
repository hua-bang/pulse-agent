import type { ServerResponse } from 'http';

import { executePiToolBridgeCall } from '../agent/backends/pi-tool-bridge';
import { replyJson } from './http-utils';

export async function handlePiToolBridgeHttpRequest(
  url: string | undefined,
  res: ServerResponse,
  body: Record<string, unknown>,
): Promise<boolean> {
  if (url !== '/pi-tools/call') return false;

  const bridgeId = typeof body.bridgeId === 'string' ? body.bridgeId : '';
  const bridgeSecret = typeof body.bridgeSecret === 'string' ? body.bridgeSecret : '';
  const toolCallId = typeof body.toolCallId === 'string' ? body.toolCallId : '';
  const name = typeof body.name === 'string' ? body.name : '';
  if (!bridgeId || !bridgeSecret || !toolCallId || !name) {
    replyJson(res, 400, {
      ok: false,
      error: 'bridgeId, bridgeSecret, toolCallId, and name are required',
    });
    return true;
  }

  try {
    const result = await executePiToolBridgeCall({
      bridgeId,
      bridgeSecret,
      toolCallId,
      name,
      input: body.input ?? {},
    });
    replyJson(res, 200, {
      ok: true,
      value: result.value,
      tools: result.tools,
      activeToolNames: result.activeToolNames,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = /expired|not found/i.test(message) ? 404
      : /credential/i.test(message) ? 403
        : 409;
    replyJson(res, status, { ok: false, error: message });
  }
  return true;
}
