// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { I18nProvider } from '../../../i18n';
import { ChatTargetBar } from '../ChatTargetBar';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('ChatTargetBar', () => {
  it('keeps scope, context, and execution policy visible together', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    act(() => {
      root.render(
        <I18nProvider>
          <ChatTargetBar
            target={{
              surface: 'page',
              scope: { kind: 'workspace', workspaceId: 'workspace-a' },
              scopeId: 'workspace-a',
              sessionId: null,
              composerId: 'page:workspace-a',
              contextSnapshot: {
                label: 'Workspace A',
                contextLabels: ['Release notes', 'Launch plan'],
              },
              executionPolicy: 'ask',
            }}
          />
        </I18nProvider>,
      );
    });

    expect(host.textContent).toContain('Workspace A');
    expect(host.textContent).toContain('Release notes');
    expect(host.textContent).toContain('Launch plan');
    expect(host.textContent).toContain('Ask first');

    act(() => root.unmount());
    host.remove();
  });
});
