// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { createEmptyMcpDraft } from '../model';
import { ServerForm } from '.';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('MCP ServerForm', () => {
  it('shows OAuth configuration and delegates save', () => {
    const onSave = vi.fn();
    const host = document.createElement('div');
    const root = createRoot(host);
    act(() => {
      root.render(
        <ServerForm
          draft={{ ...createEmptyMcpDraft(), auth: 'oauth' }}
          saving={false}
          t={(key) => String(key)}
          onChange={vi.fn()}
          onCancel={vi.fn()}
          onSave={onSave}
        />,
      );
    });
    expect(host.textContent).toContain('mcpConfig.oauthClientId');
    expect(host.textContent).toContain('mcpConfig.oauthClientSecret');
    act(() => { [...host.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === 'mcpConfig.save')?.click(); });
    expect(onSave).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
  });
});
