// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../../i18n';
import { AgentLaunchForm } from '.';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('AgentLaunchForm', () => {
  it('delegates the approval toggle and command-enter launch', () => {
    const onDangerousModeChange = vi.fn();
    const onLaunch = vi.fn();
    const host = document.createElement('div');
    const root = createRoot(host);
    act(() => {
      root.render(
        <I18nProvider>
          <AgentLaunchForm
            selectedAgent="claude-code"
            cwdInput="/repo"
            promptInput="Review this repo"
            dangerousMode={false}
            recentCwds={[]}
            onCwdChange={vi.fn()}
            onPromptChange={vi.fn()}
            onDangerousModeChange={onDangerousModeChange}
            onPickFolder={vi.fn()}
            onLaunch={onLaunch}
          />
        </I18nProvider>,
      );
    });
    act(() => { host.querySelector<HTMLInputElement>('input[type="checkbox"]')?.click(); });
    expect(onDangerousModeChange).toHaveBeenCalledWith(true);
    act(() => { host.querySelector('textarea')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true })); });
    expect(onLaunch).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
  });
});
