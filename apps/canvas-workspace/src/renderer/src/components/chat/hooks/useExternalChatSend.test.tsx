// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CANVAS_AGENT_EXTERNAL_CHAT_REQUEST_EVENT,
  CANVAS_AGENT_EXTERNAL_CHAT_RESULT_EVENT,
} from '../../../../../shared/agent-chat';
import { useExternalChatSend } from './useExternalChatSend';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

const Probe = ({ sendMessage }: { sendMessage: Parameters<typeof useExternalChatSend>[1] }) => {
  useExternalChatSend('ws-1', sendMessage);
  return null;
};

describe('useExternalChatSend', () => {
  it('submits a matching request once and reports the renderer acceptance', async () => {
    const sendMessage = vi.fn().mockResolvedValue(true);
    const results: unknown[] = [];
    window.addEventListener(CANVAS_AGENT_EXTERNAL_CHAT_RESULT_EVENT, (event) => {
      results.push((event as CustomEvent).detail);
    });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => { root?.render(<Probe sendMessage={sendMessage} />); });

    await act(async () => {
      window.dispatchEvent(new CustomEvent(CANVAS_AGENT_EXTERNAL_CHAT_REQUEST_EVENT, {
        detail: {
          requestId: 'request-1',
          workspaceId: 'ws-1',
          message: 'Review the API contract.',
          sender: { agentType: 'codex', label: 'Backend Codex' },
        },
      }));
      await Promise.resolve();
    });

    expect(sendMessage).toHaveBeenCalledWith(
      'Review the API contract.',
      undefined,
      [],
      { agentType: 'codex', label: 'Backend Codex' },
    );
    expect(results).toContainEqual({ requestId: 'request-1', accepted: true });
  });
});
