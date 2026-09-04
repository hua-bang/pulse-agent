// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../../i18n';
import { ChatEmptyState } from '../ChatEmptyState';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement | null = null;
let root: Root | null = null;

const renderEmptyState = (props: Partial<Parameters<typeof ChatEmptyState>[0]> = {}) => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root?.render(
      <I18nProvider>
        <ChatEmptyState
          onQuickAction={() => undefined}
          {...props}
        />
      </I18nProvider>,
    );
  });
  return host;
};

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  window.localStorage.clear();
});

describe('ChatEmptyState scope semantics', () => {
  it('uses cross-workspace language and actions for global chat', () => {
    const onQuickAction = vi.fn();
    const rendered = renderEmptyState({ variant: 'global', onQuickAction });

    expect(rendered.textContent).toContain('What would you like to move forward?');
    expect(rendered.textContent).toContain('Review recent work');
    expect(rendered.textContent).toContain('Find connections');
    expect(rendered.textContent).toContain('Surface open threads');
    expect(rendered.textContent).not.toContain('current canvas');
    expect(rendered.textContent).not.toContain('Summarize canvas');

    act(() => {
      rendered.querySelector<HTMLButtonElement>('.chat-quick-action')?.click();
    });
    expect(onQuickAction).toHaveBeenCalledWith(
      'Review my recent work across workspaces and conversations. Summarize progress, decisions, and next steps.',
      'review_recent_work',
    );
  });
});
