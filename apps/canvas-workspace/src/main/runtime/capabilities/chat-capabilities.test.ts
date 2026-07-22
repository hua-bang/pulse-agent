import { beforeEach, describe, expect, it, vi } from 'vitest';

const executeExternalChat = vi.hoisted(() => vi.fn());

vi.mock('./chat-execution', () => ({ executeExternalChat }));

import { CapabilityRuntime } from './runtime';
import { createChatCapabilities } from './chat-capabilities';

describe('Canvas Agent chat capability', () => {
  beforeEach(() => executeExternalChat.mockReset());

  it('forwards a labelled coding-agent message through the shared executor', async () => {
    executeExternalChat.mockResolvedValue({ accepted: true });
    const runtime = new CapabilityRuntime(createChatCapabilities());
    const context = { workspaceId: 'ws-1', actor: { kind: 'pulse-cli' as const } };
    const input = {
      message: 'Please review the new API contract.',
      sender: { agentType: 'codex', label: 'Backend Codex' },
    };

    await expect(runtime.call('canvas.agent.chat', input, context)).resolves.toEqual({
      ok: true,
      value: { accepted: true },
    });
    expect(executeExternalChat).toHaveBeenCalledWith(input, context);
  });

  it('rejects unrecognised sender icons before touching the renderer', async () => {
    const runtime = new CapabilityRuntime(createChatCapabilities());

    await expect(runtime.call(
      'canvas.agent.chat',
      {
        message: 'Hello',
        sender: { agentType: 'untrusted-svg-url', label: 'Unknown agent' },
      },
      { workspaceId: 'ws-1', actor: { kind: 'pulse-cli' } },
    )).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid_input' },
    });
    expect(executeExternalChat).not.toHaveBeenCalled();
  });
});
