// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../i18n';
import { useChatDeliveryNotifier } from '../useChatDeliveryNotifier';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const notify = vi.fn();
vi.mock('../../shell/AppShellProvider', () => ({
  useAppShell: () => ({ notify }),
}));

describe('useChatDeliveryNotifier', () => {
  it('describes an unassigned draft without exposing a synthetic workspace', async () => {
    const host = document.createElement('div');
    const root = createRoot(host);
    const Harness = () => {
      const report = useChatDeliveryNotifier();
      return (
        <button type="button" onClick={() => report({
          status: 'delivered',
          target: {
            surface: 'page',
            scope: { kind: 'global' },
            scopeId: '__global_chat__',
            sessionId: null,
            composerId: 'page:global',
            contextSnapshot: { label: 'No workspace' },
            executionPolicy: 'auto',
          },
        })}>
          report
        </button>
      );
    };

    await act(async () => root.render(<I18nProvider><Harness /></I18nProvider>));
    act(() => host.querySelector('button')?.click());

    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ title: 'Added to AI Chat' }));
    expect(notify.mock.calls[0]?.[0]?.title).not.toContain('No workspace');

    act(() => root.unmount());
  });
});
