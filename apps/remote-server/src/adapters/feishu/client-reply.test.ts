import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { sendTextMessage } from './client.js';

describe('Feishu reply in thread', () => {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];

  beforeEach(() => {
    calls.length = 0;
    vi.stubEnv('FEISHU_APP_ID', 'cli_test');
    vi.stubEnv('FEISHU_APP_SECRET', 'secret');
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init?.body ?? '{}')) });
      const data = url.includes('tenant_access_token')
        ? { code: 0, tenant_access_token: 't', expire: 7200 }
        : { code: 0, data: { message_id: 'om_bot' } };
      return new Response(JSON.stringify(data), { status: 200 });
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  function replyBody(): Record<string, unknown> | undefined {
    return calls.find((call) => call.url.includes('/reply'))?.body;
  }

  it('sets reply_in_thread only when asked', async () => {
    await sendTextMessage({} as any, 'oc_group', 'chat_id', 'hi', { replyToMessageId: 'om_q', replyInThread: true });
    expect(replyBody()).toMatchObject({ msg_type: 'text', reply_in_thread: true });

    calls.length = 0;
    await sendTextMessage({} as any, 'oc_group', 'chat_id', 'hi', { replyToMessageId: 'om_q' });
    expect(replyBody()).not.toHaveProperty('reply_in_thread');
  });
});
