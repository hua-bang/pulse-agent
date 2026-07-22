// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import { I18nProvider } from '../../../i18n';
import { ChatMessage } from '../ChatMessage';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe('ChatMessage sender identity', () => {
  it('renders a persisted coding-agent label and its curated icon', () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);

    act(() => {
      root?.render(
        <I18nProvider>
          <ChatMessage
            message={{
              role: 'user',
              content: 'Please review the API contract.',
              timestamp: 1,
              sender: { agentType: 'codex', label: 'Backend Codex' },
            }}
            index={0}
            isStreaming={false}
            loading={false}
            collapsed={false}
            expandedTools={new Set()}
            workspaceId="ws-1"
            onToggleSection={() => {}}
            onToggleToolExpand={() => {}}
          />
        </I18nProvider>,
      );
    });

    expect(host.querySelector('[aria-label="Message from Backend Codex (Codex)"]')).not.toBeNull();
    expect(host.textContent).toContain('Backend Codex');
  });
});
