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

  it('sits under the card in screen space and sends a question scoped to it', async () => {
    const onAsk = vi.fn(async () => ({ status: 'delivered' as const, target }));
    act(() => root.render(
      <I18nProvider><NodeAskBar node={node} transform={{ x: 10, y: 20, scale: 2 }} onAsk={onAsk} /></I18nProvider>,
    ));
    const form = host.querySelector('form') as HTMLFormElement;
    const input = host.querySelector('input') as HTMLInputElement;

    expect(form.style.left).toBe('210px');
    expect(form.style.top).toBe(`${(40 + 120) * 2 + 20 + 10}px`);

    type(input, 'Which tier?');
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    expect(onAsk).toHaveBeenCalledWith({
      text: 'Which tier?',
      nodes: [{ id: 'node-1', title: 'Research', type: 'text' }],
    });
    expect(input.value).toBe('');
    expect(notify).not.toHaveBeenCalled();
  });

  it('keeps the question and reports it when the chat refuses it', async () => {
    const receipt = { status: 'failed' as const, target };
    const onAsk = vi.fn(async () => receipt);
    act(() => root.render(
      <I18nProvider><NodeAskBar node={node} transform={{ x: 0, y: 0, scale: 1 }} onAsk={onAsk} /></I18nProvider>,
    ));
    const form = host.querySelector('form') as HTMLFormElement;
    const input = host.querySelector('input') as HTMLInputElement;

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
          <NodeAskBar node={node} transform={{ x: 0, y: 0, scale: 1 }} onAsk={vi.fn()} />
        </div>
      </I18nProvider>,
    ));

    act(() => {
      host.querySelector('input')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });

    expect(onCanvasMouseDown).not.toHaveBeenCalled();
  });
});
