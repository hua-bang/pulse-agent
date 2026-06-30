import { Hono } from 'hono';
import { dispatch } from '../core/dispatcher.js';
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
feishuRouter.post('/', (c) => {
  const source = getFeishuEventSource();
  if (source === 'long_connection') {
    return c.json({}, 200);
  }

  return dispatch(feishuAdapter, c);
});
