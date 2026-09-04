// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../../i18n';
import { AgentAvailability } from '.';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('AgentAvailability', () => {
  it('disables a missing CLI and presents its installation guide', async () => {
    (window as unknown as { canvasWorkspace: unknown }).canvasWorkspace = {
      pty: { checkCommand: vi.fn().mockResolvedValue({ ok: true, available: false }) },
      shell: { openExternal: vi.fn() },
    };
    const host = document.createElement('div');
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <I18nProvider>
          <AgentAvailability selectedAgent="codex" onAgentChange={vi.fn()} onStartAnyway={vi.fn()} />
        </I18nProvider>,
      );
      await Promise.resolve();
    });
    expect(host.querySelector('[role="tab"][aria-label*="Codex"]')?.hasAttribute('disabled')).toBe(true);
    expect(host.textContent).toContain('curl -fsSL https://chatgpt.com/codex/install.sh | sh');
    act(() => root.unmount());
    delete (window as unknown as { canvasWorkspace?: unknown }).canvasWorkspace;
  });
});
