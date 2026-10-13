// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../i18n';
import { ChatTargetProvider, useChatTargetBroker, type ChatTargetBroker } from '../../../modules/chat';
import { Launcher } from '.';

const notify = vi.fn();
vi.mock('../../../shared/appShell', () => ({
  useAppShell: () => ({ notify }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let broker: ChatTargetBroker;

const BrokerProbe = () => {
  broker = useChatTargetBroker();
  return null;
};

const props = {
  workspaces: [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }],
  onEnterChat: vi.fn(),
  onOpenWorkspace: vi.fn(),
  onCreateWorkspace: vi.fn(),
};

const render = () => act(() => root.render(
  <I18nProvider>
    <ChatTargetProvider>
      <BrokerProbe />
      <Launcher {...props} />
    </ChatTargetProvider>
  </I18nProvider>,
));

beforeEach(() => {
  vi.clearAllMocks();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('Launcher', () => {
  it('opens and creates workspaces from the cards', async () => {
    await render();
    const cards = [...host.querySelectorAll<HTMLButtonElement>('.launcher__card')];
    expect(cards.map((card) => card.textContent)).toEqual(['New workspace', 'Alpha', 'Beta']);
    await act(async () => cards[0].click());
    await act(async () => cards[2].click());
    expect(props.onCreateWorkspace).toHaveBeenCalledTimes(1);
    expect(props.onOpenWorkspace).toHaveBeenCalledWith('b');
  });

  it('enters the global chat page and sends the question once its composer registers', async () => {
    await render();
    const input = host.querySelector<HTMLInputElement>('.launcher__ask-input')!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setValue.call(input, '  plan my week  ');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const submitPrompt = vi.fn().mockResolvedValue(true);
    props.onEnterChat.mockImplementation((target) => {
      // The page registers a moment after navigation, like the lazy chat page.
      setTimeout(() => broker.register(target, { submitPrompt }), 150);
    });

    await act(async () => {
      host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 400));
    });

    expect(props.onEnterChat).toHaveBeenCalledWith(expect.objectContaining({
      surface: 'page',
      scope: { kind: 'global' },
      sessionId: null,
    }));
    expect(submitPrompt).toHaveBeenCalledWith({ text: 'plan my week', nodes: [] });
    expect(input.value).toBe('');
    expect(notify).not.toHaveBeenCalled();
  });
});
