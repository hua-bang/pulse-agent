import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const bot = { open_id: 'ou_bot', app_name: 'Pulse' };

function mockBotInfo(payload: unknown): void {
  vi.stubGlobal('fetch', vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({
      code: 0, tenant_access_token: 'test-token', expire: 7200,
    })))
    .mockResolvedValueOnce(new Response(JSON.stringify(payload))));
}

function groupEvent(openId: string): unknown {
  return {
    message: {
      message_id: 'm1', chat_id: 'group1', chat_type: 'group', message_type: 'text',
      content: JSON.stringify({ text: '@_user_1 hello' }),
      mentions: [{ key: '@_user_1', id: { open_id: openId }, name: 'Pulse' }],
    },
    sender: { sender_id: { open_id: 'ou_sender' } },
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('FEISHU_APP_ID', 'cli_bot');
  vi.stubEnv('FEISHU_APP_SECRET', 'test-secret');
  vi.stubEnv('FEISHU_API_BASE_URL', 'https://open.feishu.cn');
  for (const key of ['OPEN_ID', 'USER_ID', 'UNION_ID', 'NAME']) {
    vi.stubEnv(`FEISHU_BOT_${key}`, '');
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('Feishu bot identity loading', () => {
  it('reads the bot envelope returned by the bot/v3/info endpoint', async () => {
    mockBotInfo({ code: 0, msg: 'ok', bot });
    const { getFeishuBotInfo } = await import('../feishu-client');
    await expect(getFeishuBotInfo()).resolves.toEqual({ openId: 'ou_bot', appName: 'Pulse' });
  });

  it('accepts a group mention with the API-loaded identity, but not a same-name user', async () => {
    mockBotInfo({ code: 0, msg: 'ok', bot });
    const { loadBotIdentity } = await import('../bot-mention');
    const { parseInbound } = await import('../feishu-channel');
    const identity = await loadBotIdentity('cli_bot');
    expect(parseInbound(groupEvent('ou_bot'), identity)).toMatchObject({
      text: 'hello', isMention: true, isDirect: false,
    });
    expect(parseInbound(groupEvent('ou_other'), identity)).toBeNull();
  });

  it('preserves the previously supported data envelope', async () => {
    mockBotInfo({ code: 0, msg: 'ok', data: bot });
    const { getFeishuBotInfo } = await import('../feishu-client');
    await expect(getFeishuBotInfo()).resolves.toEqual({ openId: 'ou_bot', appName: 'Pulse' });
  });

  it('rejects a successful response without a usable bot open_id', async () => {
    mockBotInfo({ code: 0, msg: 'ok', bot: { app_name: 'Pulse', open_id: ' ' } });
    const { getFeishuBotInfo } = await import('../feishu-client');
    await expect(getFeishuBotInfo()).rejects.toThrow('missing bot open_id');
  });

  it('uses the existing env fallback with a warning for a malformed response', async () => {
    mockBotInfo({ code: 0, msg: 'ok' });
    vi.stubEnv('FEISHU_BOT_OPEN_ID', 'ou_fallback');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { loadBotIdentity } = await import('../bot-mention');
    await expect(loadBotIdentity('cli_bot')).resolves.toMatchObject({ openId: 'ou_fallback' });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('failed to load bot identity'), expect.any(Error),
    );
  });

  it('still rejects API errors', async () => {
    mockBotInfo({ code: 999, msg: 'denied' });
    const { getFeishuBotInfo } = await import('../feishu-client');
    await expect(getFeishuBotInfo()).rejects.toThrow('denied');
  });
});
