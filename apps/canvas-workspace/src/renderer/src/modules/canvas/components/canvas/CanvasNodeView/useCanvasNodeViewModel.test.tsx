// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { CanvasNode } from '../../../../../types';
import { I18nProvider } from '../../../../../i18n';
import { AppShellProvider } from '../../../../../components/shell/AppShellProvider';
import type { ChatDeliveryReceipt } from '../../../../chat';
import { useCanvasNodeViewModel } from './useCanvasNodeViewModel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('useCanvasNodeViewModel', () => {
  let root: Root;
  let host: HTMLElement;
  let viewModel: ReturnType<typeof useCanvasNodeViewModel>;
  let titleElement: HTMLSpanElement;
  let onParentKeyDown: ReturnType<typeof vi.fn>;
  let onParentPaste: ReturnType<typeof vi.fn>;
  let execCommand: (commandId: string, showUI?: boolean, value?: string) => boolean;
  let onAddToChat: Mock<[string], Promise<ChatDeliveryReceipt>>;
  let onResizeStart: ReturnType<typeof vi.fn>;
  let onUpdate: ReturnType<typeof vi.fn>;

  const node = {
    id: 'text-1',
    type: 'text',
    title: 'Text',
    x: 10,
    y: 20,
    width: 240,
    height: 100,
    data: { content: 'hello', autoSize: true },
    updatedAt: 1,
  } as CanvasNode;

  const Probe = () => {
    viewModel = useCanvasNodeViewModel({
      embedded: false,
      focusState: 'neutral',
      isFullscreen: false,
      readOnly: false,
      isDragging: false,
      isHighlighted: false,
      isResizing: false,
      isSelected: true,
      node,
      onAddToChat,
      onDragStart: vi.fn(),
      onFocus: vi.fn(),
      onRemove: vi.fn(),
      onResizeStart,
      onSelect: vi.fn(),
      onUpdate: onUpdate as (id: string, patch: Partial<CanvasNode>) => void,
    });
    return (
      <div onKeyDown={onParentKeyDown} onPaste={onParentPaste}>
        <span
          ref={viewModel.titleRef}
          contentEditable={viewModel.isEditingTitle}
          onBlur={viewModel.handleTitleBlur}
          onKeyDown={viewModel.handleTitleKeyDown}
          onPaste={viewModel.handleTitlePaste}
          suppressContentEditableWarning
        >
          {node.title}
        </span>
      </div>
    );
  };

  beforeEach(() => {
    onParentKeyDown = vi.fn();
    onParentPaste = vi.fn();
    onAddToChat = vi.fn();
    onResizeStart = vi.fn();
    onUpdate = vi.fn();
    execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: execCommand,
    });
    vi.spyOn(globalThis, 'requestAnimationFrame').mockReturnValue(1);
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root.render(
      <I18nProvider>
        <AppShellProvider><Probe /></AppShellProvider>
      </I18nProvider>,
    ));
    titleElement = host.querySelector('span') as HTMLSpanElement;
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    Reflect.deleteProperty(document, 'execCommand');
    vi.restoreAllMocks();
  });

  const startTitleEditing = (key = 'Enter') => {
    titleElement.focus();
    const event = new globalThis.KeyboardEvent('keydown', {
      key,
      bubbles: true,
      cancelable: true,
    });

    act(() => titleElement.dispatchEvent(event));
    onParentKeyDown.mockClear();
    return event;
  };

  it('starts an ephemeral resize without disabling auto-size on mousedown', () => {
    const event = { button: 0 } as React.MouseEvent;

    act(() => viewModel.makeResizeHandler('right')(event));

    expect(onUpdate).not.toHaveBeenCalled();
    expect(onResizeStart).toHaveBeenCalledWith(event, 'text-1', 240, 100, 'right', 40, 28);
  });

  it('awaits an add-to-chat receipt and announces the actual queued target', async () => {
    let resolveReceipt!: (receipt: ChatDeliveryReceipt) => void;
    onAddToChat.mockReturnValue(new Promise<ChatDeliveryReceipt>((resolve) => {
      resolveReceipt = resolve;
    }));
    const event = { stopPropagation: vi.fn() } as unknown as React.MouseEvent;

    const delivery = viewModel.handleAddToChat(event);
    expect(document.body.textContent).not.toContain('Queued for Global chat');

    resolveReceipt({
      status: 'queued',
      target: {
        surface: 'page',
        scope: { kind: 'global' },
        scopeId: '__global_chat__',
        sessionId: null,
        composerId: 'page:global',
        contextSnapshot: { label: 'Global chat' },
        executionPolicy: 'auto',
      },
    });
    await act(async () => delivery);

    expect(onAddToChat).toHaveBeenCalledWith('text-1');
    expect(document.body.textContent).toContain('Queued for AI Chat');
  });

  it('commits a trimmed title with Enter', () => {
    startTitleEditing();
    titleElement.textContent = '  Renamed node  ';
    titleElement.focus();
    const event = new globalThis.KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    });

    act(() => titleElement.dispatchEvent(event));

    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).not.toBe(titleElement);
    expect(onUpdate).toHaveBeenCalledWith('text-1', { title: 'Renamed node' });
  });

  it('contains Escape inside title editing and restores the persisted title', () => {
    startTitleEditing();
    titleElement.textContent = 'Unsaved title';
    titleElement.focus();
    const event = new globalThis.KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });

    act(() => titleElement.dispatchEvent(event));

    expect(event.defaultPrevented).toBe(true);
    expect(onParentKeyDown).not.toHaveBeenCalled();
    expect(titleElement.textContent).toBe('Text');
    expect(document.activeElement).not.toBe(titleElement);
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it.each(['Enter', 'Escape'])('leaves %s to an active IME composition', (key) => {
    startTitleEditing();
    titleElement.textContent = '正在输入';
    titleElement.focus();
    const event = new globalThis.KeyboardEvent('keydown', {
      key,
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, 'isComposing', { value: true });

    act(() => titleElement.dispatchEvent(event));

    expect(event.defaultPrevented).toBe(false);
    expect(onParentKeyDown).toHaveBeenCalledTimes(1);
    expect(titleElement.textContent).toBe('正在输入');
    expect(document.activeElement).toBe(titleElement);
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('restores the persisted title when an empty edit loses focus', () => {
    startTitleEditing();
    titleElement.textContent = '';
    titleElement.focus();

    act(() => titleElement.blur());

    expect(titleElement.textContent).toBe('Text');
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('restores the persisted title when an empty edit is submitted with Enter', () => {
    startTitleEditing();
    titleElement.textContent = '';
    titleElement.focus();
    const event = new globalThis.KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    });

    act(() => titleElement.dispatchEvent(event));

    expect(event.defaultPrevented).toBe(true);
    expect(titleElement.textContent).toBe('Text');
    expect(document.activeElement).not.toBe(titleElement);
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it.each(['Enter', 'F2'])('starts title editing with %s and contains the shortcut', (key) => {
    expect(viewModel.isEditingTitle).toBe(false);

    titleElement.focus();
    const event = new globalThis.KeyboardEvent('keydown', {
      key,
      bubbles: true,
      cancelable: true,
    });
    act(() => titleElement.dispatchEvent(event));

    expect(event.defaultPrevented).toBe(true);
    expect(onParentKeyDown).not.toHaveBeenCalled();
    expect(viewModel.isEditingTitle).toBe(true);
  });

  it('pastes multiline clipboard text as one plain-text line without bubbling', () => {
    startTitleEditing();
    const getData = vi.fn(() => 'First line\r\n  Second line\n\nThird\u2028line');
    const event = new globalThis.Event('paste', {
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, 'clipboardData', {
      value: { getData },
    });

    act(() => titleElement.dispatchEvent(event));

    expect(event.defaultPrevented).toBe(true);
    expect(onParentPaste).not.toHaveBeenCalled();
    expect(getData).toHaveBeenCalledWith('text/plain');
    expect(execCommand).toHaveBeenCalledWith(
      'insertText',
      false,
      'First line Second line Third line',
    );
  });
});
