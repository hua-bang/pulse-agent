import { Hono } from 'hono';
import { dispatchIncoming } from '../core/dispatcher.js';
import { feishuAdapter } from '../adapters/feishu/adapter.js';
import { getFeishuEventSource } from '../adapters/feishu/gateway.js';

export const feishuRouter = new Hono();

/**
 * POST /webhooks/feishu
 * Receives Feishu (Lark) event webhook calls.
 *
 * Configure in Feishu Open Platform:
 *   Event subscription URL: https://your-server/webhooks/feishu
 *   Events to subscribe: im.message.receive_v1
 */
feishuRouter.post('/', async (c) => {
  const source = getFeishuEventSource();
  if (source === 'long_connection') {
    return c.json({}, 200);
  }

  const valid = await feishuAdapter.verifyRequest(c.req);
  if (!valid) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  let body: Record<string, unknown> | null = null;
  try {
    body = await c.req.json() as Record<string, unknown>;
  } catch {
    body = null;
  }

  if (body && await feishuAdapter.handleCardActionBody(body)) {
    return c.json({}, 200);
  }

  if (body) {
    const incoming = await feishuAdapter.parseEventBody(body);
    const response = feishuAdapter.ackRequest(c, incoming);
    if (incoming) {
      dispatchIncoming(feishuAdapter, incoming);
    }
    return response;
  }

  return c.json({}, 200);
});
