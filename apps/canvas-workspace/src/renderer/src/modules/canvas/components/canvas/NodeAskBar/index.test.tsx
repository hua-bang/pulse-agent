// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanvasNode } from '../../../../../types';
import type { ChatTarget } from '../../../../chat';
import { I18nProvider } from '../../../../../i18n';
import { NodeAskBar } from './index';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const notify = vi.fn();
vi.mock('../../../../chat/delivery', () => ({ useChatDeliveryNotifier: () => notify }));

const node: CanvasNode = {
  id: 'node-1',
  type: 'text',
  title: 'Research',
  x: 100,
  y: 40,
  width: 200,
  height: 120,
  data: {
    content: 'Pricing tiers',
    textColor: '#1f2328',
    backgroundColor: 'transparent',
    fontSize: 18,
    autoSize: true,
  },
};

const target: ChatTarget = {
  surface: 'dock',
  scope: { kind: 'workspace', workspaceId: 'workspace-1' },
  scopeId: 'workspace-1',
  sessionId: null,
  composerId: 'dock:workspace-1',
  contextSnapshot: { label: 'Workspace 1' },
  executionPolicy: 'auto',
};

describe('NodeAskBar', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    notify.mockClear();
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  const type = (input: HTMLInputElement, value: string) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    act(() => {
      setter?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };

  const open = () => {
    act(() => host.querySelector<HTMLButtonElement>('.node-ask-bar__chip')!.click());
    return host.querySelector('input') as HTMLInputElement;
  };

  it('starts as a chip and folds back when left empty or on Escape', () => {
    act(() => root.render(
      <I18nProvider><NodeAskBar workspaceId="ws-a" node={node} transform={{ x: 0, y: 0, scale: 1 }} onAsk={vi.fn()} /></I18nProvider>,
    ));
    expect(host.querySelector('input')).toBeNull();

    let input = open();
    expect(document.activeElement).toBe(input);
    act(() => input.blur());
    expect(host.querySelector('input')).toBeNull();

    input = open();
    type(input, 'draft');
    act(() => input.blur());
    // A typed question stays open.
    expect(host.querySelector('input')).not.toBeNull();
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(host.querySelector('input')).toBeNull();
    expect(host.querySelector('.node-ask-bar__chip')).not.toBeNull();
  });

  it('sits under the card in screen space and sends a question scoped to it', async () => {
    const onAsk = vi.fn(async () => ({ status: 'delivered' as const, target }));
    act(() => root.render(
      <I18nProvider><NodeAskBar workspaceId="ws-a" node={node} transform={{ x: 10, y: 20, scale: 2 }} onAsk={onAsk} /></I18nProvider>,
    ));
    const form = host.querySelector('form') as HTMLFormElement;
    const input = open();

    expect(form.style.left).toBe('210px');
    expect(form.style.top).toBe(`${(40 + 120) * 2 + 20 + 24}px`);

    type(input, 'Which tier?');
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    // The first question about a card starts its own conversation.
    expect(onAsk).toHaveBeenCalledWith({
      text: 'Which tier?',
      nodes: [{ id: 'node-1', title: 'Research', type: 'text' }],
      newSession: true,
    });
    // Sent: the bar folds back to its chip.
    expect(host.querySelector('input')).toBeNull();
    expect(notify).not.toHaveBeenCalled();

    // A follow-up about the same card keeps that conversation.
    type(open(), 'And the price?');
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(onAsk).toHaveBeenLastCalledWith({
      text: 'And the price?',
      nodes: [{ id: 'node-1', title: 'Research', type: 'text' }],
    });

    // A question in another workspace does not end this one's conversation.
    const other = { ...node, id: 'node-2' };
    act(() => root.render(
      <I18nProvider><NodeAskBar workspaceId="ws-b" node={other} transform={{ x: 0, y: 0, scale: 1 }} onAsk={onAsk} /></I18nProvider>,
    ));
    type(open(), 'Elsewhere?');
    await act(async () => {
      host.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(onAsk).toHaveBeenLastCalledWith(expect.objectContaining({ newSession: true }));

    act(() => root.render(
      <I18nProvider><NodeAskBar workspaceId="ws-a" node={node} transform={{ x: 0, y: 0, scale: 1 }} onAsk={onAsk} /></I18nProvider>,
    ));
    type(open(), 'Back again?');
    await act(async () => {
      host.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(onAsk).toHaveBeenLastCalledWith({
      text: 'Back again?',
      nodes: [{ id: 'node-1', title: 'Research', type: 'text' }],
    });
  });

  it('keeps the question and reports it when the chat refuses it', async () => {
    const receipt = { status: 'failed' as const, target };
    const onAsk = vi.fn(async () => receipt);
    act(() => root.render(
      <I18nProvider><NodeAskBar workspaceId="ws-a" node={node} transform={{ x: 0, y: 0, scale: 1 }} onAsk={onAsk} /></I18nProvider>,
    ));
    const form = host.querySelector('form') as HTMLFormElement;
    const input = open();

    type(input, 'Which tier?');
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    expect(input.value).toBe('Which tier?');
    expect(notify).toHaveBeenCalledWith(receipt, 'Research');
  });

  it('keeps canvas gestures from starting under the bar', () => {
    const onCanvasMouseDown = vi.fn();
    act(() => root.render(
      <I18nProvider>
        <div onMouseDown={onCanvasMouseDown}>
          <NodeAskBar workspaceId="ws-a" node={node} transform={{ x: 0, y: 0, scale: 1 }} onAsk={vi.fn()} />
        </div>
      </I18nProvider>,
    ));

    act(() => {
      host.querySelector('.node-ask-bar__chip')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });

    expect(onCanvasMouseDown).not.toHaveBeenCalled();
  });
});
