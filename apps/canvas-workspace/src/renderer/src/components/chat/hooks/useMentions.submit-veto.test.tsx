// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../i18n';
import { useMentions } from './useMentions';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Hook = ReturnType<typeof useMentions>;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let latest: Hook | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  latest = null;
  vi.restoreAllMocks();
});

async function mount(options: {
  onSubmit: (text: string) => Promise<boolean>;
  isSubmitBlocked: () => boolean;
}): Promise<void> {
  const Probe = () => {
    latest = useMentions({
      agentScope: { kind: 'global' },
      onSubmit: options.onSubmit,
      isSubmitBlocked: options.isSubmitBlocked,
    });
    return null;
  };

  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
  });
}

/** Minimal stand-in for the composer's Enter keydown. */
function enterKeyEvent() {
  return {
    key: 'Enter',
    shiftKey: false,
    preventDefault: vi.fn(),
    nativeEvent: {},
    currentTarget: document.createElement('div'),
  } as never;
}

describe('composer submit veto', () => {
  it('blocks BOTH submit paths while the veto is up', async () => {
    const onSubmit = vi.fn(async () => true);
    let blocked = true;
    await mount({ onSubmit, isSubmitBlocked: () => blocked });

    // Send button.
    await act(async () => { await latest!.submitCurrentInput(); });
    expect(onSubmit).not.toHaveBeenCalled();

    // Enter key — a separate path into submitCurrentInput, which is exactly
    // why the veto lives inside the hook rather than in a caller's handler.
    await act(async () => { latest!.handleKeyDown(enterKeyEvent()); });
    expect(onSubmit).not.toHaveBeenCalled();

    // ...and sends again once the thread has finished loading.
    blocked = false;
    await act(async () => { await latest!.submitCurrentInput(); });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('reports the send as not-sent so the draft survives', async () => {
    const onSubmit = vi.fn(async () => true);
    await mount({ onSubmit, isSubmitBlocked: () => true });

    let sent: boolean | undefined;
    await act(async () => { sent = await latest!.submitCurrentInput(); });

    expect(sent).toBe(false);
  });
});
