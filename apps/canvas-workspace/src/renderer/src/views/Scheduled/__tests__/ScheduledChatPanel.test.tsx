// @vitest-environment happy-dom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../i18n';

const captured = vi.hoisted(() => ({
  mountCount: 0,
  refreshKey: -1 as string | number,
}));

vi.mock('../../../components/chat/lazy', () => ({
  ChatPanelLazy: ({ sessionRefreshKey }: { sessionRefreshKey?: string | number }) => {
    const [draft, setDraft] = useState(() => {
      captured.mountCount += 1;
      return '';
    });
    captured.refreshKey = sessionRefreshKey ?? -1;
    return (
      <input
        aria-label="Mock draft"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
    );
  },
}));

import { ScheduledChatPanel } from '../ScheduledChatPanel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  captured.mountCount = 0;
  captured.refreshKey = -1;
});

describe('ScheduledChatPanel', () => {
  it('refreshes history without remounting or losing the composer draft', async () => {
    Object.defineProperty(window, 'canvasWorkspace', {
      configurable: true,
      value: {
        scheduled: {
          list: vi.fn(async () => ({ ok: true, tasks: [] })),
          onChanged: vi.fn(() => () => undefined),
        },
      },
    });
    host = document.createElement('div');
    root = createRoot(host);
    const render = (revision: number) => (
      <I18nProvider>
        <ScheduledChatPanel
          taskId="daily"
          revision={revision}
          allWorkspaces={[]}
          onClose={vi.fn()}
          onOpenAppSettings={vi.fn()}
          onTurnComplete={vi.fn()}
          onOpenSessionInScope={vi.fn()}
        />
      </I18nProvider>
    );

    await act(async () => root?.render(render(1)));
    const input = host.querySelector<HTMLInputElement>('input')!;
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set;
      valueSetter?.call(input, 'keep this draft');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await act(async () => root?.render(render(2)));

    expect(captured.mountCount).toBe(1);
    expect(captured.refreshKey).toBe(2);
    expect(host.querySelector<HTMLInputElement>('input')?.value).toBe('keep this draft');
  });
});
