import { beforeEach, describe, expect, it, vi } from 'vitest';

const resolveHostRenderer = vi.hoisted(() => vi.fn());
const evalInPage = vi.hoisted(() => vi.fn());

vi.mock('./host-renderer-execution', () => ({ resolveHostRenderer }));
vi.mock('../../../plugins/main/webview-page-control/js-primitives', () => ({ evalInPage }));

import { buildExternalChatScript, executeExternalChat } from './chat-execution';

describe('external Canvas Agent chat execution', () => {
  beforeEach(() => {
    resolveHostRenderer.mockReset();
    evalInPage.mockReset();
  });

  it('dispatches a safe labelled request and waits for the renderer acceptance', async () => {
    const runner = { id: 101, executeJavaScript: vi.fn() };
    resolveHostRenderer.mockResolvedValue(runner);
    evalInPage.mockResolvedValue({ ok: true, data: { value: { accepted: true } } });

    await expect(executeExternalChat(
      { message: 'Review the API contract.', sender: { agentType: 'codex', label: 'Backend Codex' } },
      { workspaceId: 'ws-1', actor: { kind: 'pulse-cli' } },
    )).resolves.toEqual({ accepted: true });

    expect(resolveHostRenderer).toHaveBeenCalledWith('ws-1');
    expect(evalInPage).toHaveBeenCalledWith(
      runner,
      expect.stringContaining('Backend Codex'),
      6_000,
    );
  });

  it('encodes message text before putting it in the renderer script', () => {
    const script = buildExternalChatScript(
      { message: '"; globalThis.pwned = true; //', sender: { agentType: 'claude-code', label: 'Claude Code' } },
      'request-1',
      'ws-1',
    );

    expect(script).toContain('"message":"\\\"; globalThis.pwned = true; //"');
    expect(script).toContain('"workspaceId":"ws-1"');
    expect(script).toContain('"agentType":"claude-code"');
  });
});
