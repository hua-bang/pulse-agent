import * as lark from '@larksuiteoapi/node-sdk';
import { dispatchIncoming } from '../../core/dispatcher.js';
import { feishuAdapter } from './adapter.js';

type FeishuEventSource = 'webhook' | 'long_connection' | 'both';

let wsClient: lark.WSClient | null = null;
let started = false;

export function getFeishuEventSource(): FeishuEventSource {
  const value = process.env.FEISHU_EVENT_SOURCE?.trim().toLowerCase();

  if (value === 'long_connection' || value === 'long-connection' || value === 'ws' || value === 'websocket') {
    return 'long_connection';
  }

  if (value === 'both') {
    return 'both';
  }

  return 'webhook';
}

export function shouldStartFeishuLongConnection(source = getFeishuEventSource()): boolean {
  return source === 'long_connection' || source === 'both';
}

export function startFeishuLongConnection(): void {
  if (started) {
    return;
  }

  const source = getFeishuEventSource();
  if (!shouldStartFeishuLongConnection(source)) {
    console.log('[feishu-ws] Long-connection listener disabled by FEISHU_EVENT_SOURCE=webhook');
    return;
  }

  const appId = process.env.FEISHU_APP_ID?.trim();
  const appSecret = process.env.FEISHU_APP_SECRET?.trim();
  if (!appId || !appSecret) {
    console.log('[feishu-ws] Long-connection listener disabled: FEISHU_APP_ID/FEISHU_APP_SECRET are not set');
    return;
  }

  started = true;

  const eventDispatcher = new lark.EventDispatcher({
    loggerLevel: lark.LoggerLevel.info,
  }).register({
    'im.message.receive_v1': async (data) => {
      const incoming = await feishuAdapter.parseEventBody(data as Record<string, unknown>);
      if (!incoming) {
        return;
      }

      dispatchIncoming(feishuAdapter, incoming);
    },
  });

  wsClient = new lark.WSClient({
    appId,
    appSecret,
    domain: lark.Domain.Feishu,
    loggerLevel: lark.LoggerLevel.info,
  });

  void wsClient.start({ eventDispatcher }).catch((err) => {
    started = false;
    console.error('[feishu-ws] Failed to start long-connection listener:', err);
  });

  console.log(`[feishu-ws] Long-connection listener starting (FEISHU_EVENT_SOURCE=${source})`);
}

export function stopFeishuLongConnection(): void {
  wsClient?.close({ force: true });
  wsClient = null;
  started = false;
}
