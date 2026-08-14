// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../i18n';
import { ChatWorkspacePicker } from '../ChatWorkspacePicker';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe('ChatWorkspacePicker', () => {
  it('preselects the current workspace and creates a global chat when chosen', async () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn(async () => true);
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);

    act(() => root?.render(
      <I18nProvider>
        <ChatWorkspacePicker
          open
          currentScope={{ kind: 'workspace', workspaceId: 'workspace-a' }}
          workspaces={[
            { id: 'workspace-a', name: 'Alpha' },
            { id: 'workspace-b', name: 'Beta' },
          ]}
          onClose={onClose}
          onConfirm={onConfirm}
        />
      </I18nProvider>,
    ));

    const options = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'));
    expect(options.map(option => option.textContent?.trim())).toEqual([
      'AlphaCurrent workspace',
      'Global chat',
      'Beta',
    ]);
    expect(options[0]?.getAttribute('aria-selected')).toBe('true');

    const globalOption = document.querySelector<HTMLButtonElement>(
      '#chat-new-destination-option-__global_chat__',
    );
    expect(globalOption).not.toBeNull();
    act(() => globalOption?.click());

    const confirmButton = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.trim() === 'Start new chat');
    expect(confirmButton).not.toBeUndefined();
    await act(async () => {
      confirmButton?.click();
      await Promise.resolve();
    });

    expect(onConfirm).toHaveBeenCalledWith({ kind: 'global' });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
