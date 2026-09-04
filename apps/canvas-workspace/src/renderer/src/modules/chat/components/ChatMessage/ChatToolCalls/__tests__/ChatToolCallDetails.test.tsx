// @vitest-environment happy-dom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import { I18nProvider } from '../../../../../../i18n';
import { ChatToolCallDetails } from '../ChatToolCallDetails';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  window.localStorage.removeItem('pulse-canvas.language');
  host = null;
  root = null;
});

const renderDetails = (node: ReactNode) => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root?.render(<I18nProvider>{node}</I18nProvider>));
};

describe('ChatToolCallDetails', () => {
  it('localizes technical section labels instead of embedding English fallbacks', () => {
    window.localStorage.setItem('pulse-canvas.language', 'zh');
    renderDetails(
      <ChatToolCallDetails
        expanded
        tool={{
          id: 1,
          name: 'bash',
          status: 'failed',
          args: { command: 'exit 1' },
          result: 'partial output',
          error: 'permission denied',
        }}
      />,
    );

    const labels = Array.from(host!.querySelectorAll('.chat-tool-call-section-label'))
      .map(element => element.textContent);
    expect(labels).toEqual(['bash · 输入', '输出', '错误']);
  });

  it('localizes session-reference message counts', () => {
    window.localStorage.setItem('pulse-canvas.language', 'zh');
    renderDetails(
      <ChatToolCallDetails
        expanded={false}
        tool={{
          id: 2,
          name: 'session_search',
          status: 'succeeded',
          result: JSON.stringify({
            ok: true,
            sessions: [{
              sessionId: 'session-1',
              workspaceId: 'workspace-1',
              workspaceName: 'Workspace',
              date: '2026-07-31',
              messageCount: 3,
            }],
          }),
        }}
      />,
    );

    expect(host!.querySelector('.chat-session-ref-count')?.textContent).toBe('3 条消息');
  });
});
