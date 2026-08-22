// @vitest-environment happy-dom
import { act, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../i18n';
import { ChatInput } from '../ChatInput';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const baseProps = {
  loading: false,
  input: 'Review this',
  contextComposer: true,
  editableRef: createRef<HTMLDivElement>(),
  onInput: vi.fn(),
  onKeyDown: vi.fn(),
  onPaste: vi.fn(),
  onSend: vi.fn(async () => true),
  onAbort: vi.fn(async () => true),
};

describe('ChatInput execution and attachment states', () => {
  it('keeps scope and execution policy out of the composer chrome', () => {
    const legacyScopeProps = { ...baseProps, workspaceLabel: 'Pulse Canvas' };
    const host = document.createElement('div');
    const root = createRoot(host);
    act(() => root.render(
      <I18nProvider>
        <ChatInput {...legacyScopeProps} />
      </I18nProvider>,
    ));

    expect(host.querySelector('.chat-scope-chip')).toBeNull();
    expect(host.querySelector('.chat-scope-capability')).toBeNull();
    expect(host.querySelector('.chat-execution-mode-btn')).toBeNull();

    act(() => root.unmount());
  });

  it('exposes the multiline contenteditable as the mention combobox', () => {
    const host = document.createElement('div');
    const root = createRoot(host);
    act(() => root.render(
      <I18nProvider>
        <ChatInput
          {...baseProps}
          mentionOpen
          mentionIndex={2}
          mentionPopup={<div id="chat-mention-listbox" role="listbox" />}
        />
      </I18nProvider>,
    ));

    const editor = host.querySelector('[role="combobox"]');
    expect(editor?.getAttribute('contenteditable')).toBe('true');
    expect(editor?.getAttribute('aria-multiline')).toBe('true');
    expect(editor?.getAttribute('aria-haspopup')).toBe('listbox');
    expect(editor?.getAttribute('aria-controls')).toBe('chat-mention-listbox');
    expect(editor?.getAttribute('aria-activedescendant')).toBe('chat-mention-option-2');

    act(() => root.unmount());
  });

  it('shows upload failure with retry and prevents sending until every image is ready', () => {
    const retry = vi.fn();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => root.render(
      <I18nProvider>
        <ChatInput
          {...baseProps}
          attachments={[{
            id: 'attachment-1',
            path: '',
            fileName: 'context.png',
            mimeType: 'image/png',
            status: 'failed',
            error: 'disk full',
          }]}
          sendDisabled
          onRetryAttachment={retry}
        />
      </I18nProvider>,
    ));

    expect(host.textContent).toContain('disk full');
    const retryButton = host.querySelector<HTMLButtonElement>('[aria-label="Retry context.png"]');
    expect(retryButton).not.toBeNull();
    act(() => retryButton?.click());
    expect(retry).toHaveBeenCalledWith('attachment-1');
    expect(host.querySelector<HTMLButtonElement>('.chat-send-btn')?.disabled).toBe(true);

    act(() => root.unmount());
    host.remove();
  });

  it('does not offer retry for an attachment rejected by a hard limit', () => {
    const host = document.createElement('div');
    const root = createRoot(host);
    act(() => root.render(
      <I18nProvider>
        <ChatInput
          {...baseProps}
          attachments={[{
            id: 'attachment-1',
            path: '',
            fileName: 'huge.png',
            mimeType: 'image/png',
            status: 'failed',
            error: 'too large',
            retryable: false,
          }]}
          onRetryAttachment={vi.fn()}
        />
      </I18nProvider>,
    ));

    expect(host.querySelector('[aria-label="Retry huge.png"]')).toBeNull();
    act(() => root.unmount());
  });

  it('names each context and attachment removal control distinctly', () => {
    const host = document.createElement('div');
    const root = createRoot(host);
    act(() => root.render(
      <I18nProvider>
        <ChatInput
          {...baseProps}
          selectedContext={[
            { key: 'node-a', kind: 'node', label: 'Release notes' },
            { key: 'tag-a', kind: 'tag', label: 'Decisions' },
          ]}
          showContextChips
          onRemoveContext={vi.fn()}
          attachments={[
            { id: 'image-a', path: '/tmp/a.png', fileName: 'a.png', status: 'ready' },
            { id: 'image-b', path: '/tmp/b.png', fileName: 'b.png', status: 'ready' },
          ]}
          onRemoveAttachment={vi.fn()}
        />
      </I18nProvider>,
    ));

    expect(host.querySelector('[aria-label="Remove Release notes from context"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Remove Decisions from context"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Remove a.png"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Remove b.png"]')).not.toBeNull();
    act(() => root.unmount());
  });

  it('only exposes image upload when the current scope supplies the capability', () => {
    const host = document.createElement('div');
    const root = createRoot(host);
    act(() => root.render(
      <I18nProvider>
        <ChatInput {...baseProps} />
      </I18nProvider>,
    ));
    expect(host.querySelector('[aria-label="Add image"]')).toBeNull();

    act(() => root.render(
      <I18nProvider>
        <ChatInput {...baseProps} onAttachFiles={vi.fn()} />
      </I18nProvider>,
    ));
    expect(host.querySelector('[aria-label="Add image"]')).not.toBeNull();
    act(() => root.unmount());
  });

  it('makes the whole composer read-only while another surface owns the run', () => {
    const host = document.createElement('div');
    const root = createRoot(host);
    act(() => root.render(
      <I18nProvider>
        <ChatInput
          {...baseProps}
          interactionDisabled
          onAttachFiles={vi.fn()}
          onSelectModel={vi.fn(async () => undefined)}
          onOpenModelSettings={vi.fn()}
        />
      </I18nProvider>,
    ));

    const editor = host.querySelector<HTMLElement>('[role="combobox"]');
    expect(editor?.getAttribute('contenteditable')).toBe('false');
    expect(editor?.getAttribute('aria-disabled')).toBe('true');
    expect(host.querySelector<HTMLButtonElement>('[aria-label="Add context"]')?.disabled).toBe(true);
    expect(host.querySelector<HTMLButtonElement>('[aria-label="Add image"]')?.disabled).toBe(true);
    expect(host.querySelector<HTMLButtonElement>('[aria-label="Choose model"]')?.disabled).toBe(true);
    act(() => root.unmount());
  });

  it('returns focus to the composer after main acknowledges Stop', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const editableRef = createRef<HTMLDivElement>();
    const onAbort = vi.fn(async () => true);
    await act(async () => root.render(
      <I18nProvider>
        <ChatInput
          {...baseProps}
          loading
          editableRef={editableRef}
          onAbort={onAbort}
        />
      </I18nProvider>,
    ));

    const stop = host.querySelector<HTMLButtonElement>('[aria-label="Stop generating"]');
    stop?.focus();
    await act(async () => {
      stop?.click();
      await Promise.resolve();
    });

    expect(onAbort).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(editableRef.current);

    act(() => root.unmount());
    host.remove();
  });

  it('uses the send arrow to queue during generation and puts Steer on the queued row', async () => {
    const host = document.createElement('div');
    const root = createRoot(host);
    const onQueue = vi.fn(async () => true);
    const onSteerQueued = vi.fn(async () => true);
    const onRemoveQueued = vi.fn();
    await act(async () => root.render(
      <I18nProvider>
        <ChatInput
          {...baseProps}
          loading
          onQueue={onQueue}
          queuedInputs={[{ id: 7, mode: 'follow-up', text: 'Change direction' }]}
          onSteerQueued={onSteerQueued}
          onRemoveQueued={onRemoveQueued}
        />
      </I18nProvider>,
    ));

    await act(async () => {
      host.querySelector<HTMLButtonElement>('[aria-label="Queue message"]')?.click();
      host.querySelector<HTMLButtonElement>('[aria-label="Steer queued message"]')?.click();
      host.querySelector<HTMLButtonElement>('[aria-label="Remove queued message"]')?.click();
    });

    expect(onQueue).toHaveBeenCalledOnce();
    expect(onSteerQueued).toHaveBeenCalledWith(7);
    expect(onRemoveQueued).toHaveBeenCalledWith(7);
    expect(host.textContent).toContain('Change direction');
    expect(host.querySelector('[aria-label="Steer current response"]')).toBeNull();
    expect(host.querySelector('[aria-label="Stop generating"]')).not.toBeNull();
    act(() => root.unmount());
  });

  it('keeps generating guidance visual without creating a second live region', () => {
    const host = document.createElement('div');
    const root = createRoot(host);
    act(() => root.render(
      <I18nProvider>
        <ChatInput
          {...baseProps}
          loading
        />
      </I18nProvider>,
    ));

    expect(host.textContent).toContain('Generating. You can keep typing.');
    expect(host.querySelector('.chat-scope-capability')).toBeNull();
    expect(host.querySelector('.chat-execution-mode-btn')).toBeNull();
    expect(host.querySelector('[aria-live]')).toBeNull();

    act(() => root.unmount());
  });
});
