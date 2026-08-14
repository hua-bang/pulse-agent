// @vitest-environment happy-dom
import { act, createRef } from 'react';
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
  it('marks the current workspace and creates a chat without a workspace when chosen', async () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn(async () => true);
    const anchorRef = createRef<HTMLButtonElement>();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);

    act(() => root?.render(
      <I18nProvider>
        <button ref={anchorRef}>New chat</button>
        <ChatWorkspacePicker
          open
          anchorRef={anchorRef}
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

    expect(document.querySelector('.ui-modal-backdrop')).toBeNull();
    const options = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'));
    expect(options.map(option => option.textContent?.trim())).toEqual([
      'AlphaCurrent workspace',
      'No workspace',
      'Beta',
    ]);
    expect(options[0]?.getAttribute('aria-selected')).toBe('true');
    expect(document.querySelector('[role="combobox"]')).toBeNull();

    const globalOption = document.querySelector<HTMLButtonElement>(
      '#chat-new-destination-option-__global_chat__',
    );
    expect(globalOption).not.toBeNull();
    await act(async () => {
      globalOption?.click();
      await Promise.resolve();
    });

    expect(onConfirm).toHaveBeenCalledWith({ kind: 'global' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('keeps scheduled chats out of the new-chat destinations', () => {
    const anchorRef = createRef<HTMLButtonElement>();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);

    act(() => root?.render(
      <I18nProvider>
        <button ref={anchorRef}>New chat</button>
        <ChatWorkspacePicker
          open
          anchorRef={anchorRef}
          currentScope={{ kind: 'scheduled', taskId: 'task-1' }}
          workspaces={[{ id: 'workspace-a', name: 'Alpha' }]}
          onClose={vi.fn()}
          onConfirm={vi.fn(async () => true)}
        />
      </I18nProvider>,
    ));

    expect(Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'))
      .map(option => option.textContent?.trim()))
      .toEqual(['No workspace', 'Alpha']);
  });

  it('adds search and keyboard selection when the workspace list is long', async () => {
    const onConfirm = vi.fn(async () => true);
    const anchorRef = createRef<HTMLButtonElement>();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    const workspaces = Array.from({ length: 8 }, (_, index) => ({
      id: `workspace-${index + 1}`,
      name: `Workspace ${index + 1}`,
    }));

    act(() => root?.render(
      <I18nProvider>
        <button ref={anchorRef}>New chat</button>
        <ChatWorkspacePicker
          open
          anchorRef={anchorRef}
          currentScope={{ kind: 'global' }}
          workspaces={workspaces}
          onClose={vi.fn()}
          onConfirm={onConfirm}
        />
      </I18nProvider>,
    ));

    const search = document.querySelector<HTMLInputElement>('[role="combobox"]');
    expect(search).not.toBeNull();
    act(() => {
      if (!search) return;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(search, 'Workspace 8');
      search.dispatchEvent(new InputEvent('input', { bubbles: true }));
    });
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(1);

    await act(async () => {
      search?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await Promise.resolve();
    });
    expect(onConfirm).toHaveBeenCalledWith({ kind: 'workspace', workspaceId: 'workspace-8' });
  });
});
