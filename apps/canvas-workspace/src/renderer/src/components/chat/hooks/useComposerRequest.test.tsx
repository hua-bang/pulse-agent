// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatComposerRequest } from '../types';
import { useComposerRequest } from './useComposerRequest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe('useComposerRequest', () => {
  it('acknowledges a submit request only after the composer accepts it', async () => {
    const request: ChatComposerRequest = {
      id: 'summarize-1',
      text: 'Summarize this canvas',
      submit: true,
      quickAction: 'summarize_canvas',
    };
    const submit = vi.fn(async (_text: string, _quickAction: string | undefined, accepted: boolean) => accepted);
    const handled = vi.fn();
    const Probe = ({ accepted }: { accepted: boolean }) => {
      useComposerRequest({
        request,
        focusInput: vi.fn(),
        replaceInput: vi.fn(),
        submitQuickAction: (text, quickAction) => submit(text, quickAction, accepted),
        onHandled: handled,
      });
      return null;
    };
    host = document.createElement('div');
    root = createRoot(host);

    await act(async () => {
      root?.render(<Probe accepted={false} />);
      await Promise.resolve();
    });
    expect(submit).toHaveBeenCalledOnce();
    expect(handled).not.toHaveBeenCalled();

    await act(async () => {
      root?.render(<Probe accepted />);
      await Promise.resolve();
    });
    expect(submit).toHaveBeenCalledTimes(2);
    expect(handled).toHaveBeenCalledWith('summarize-1');
  });

  it('retries when readiness changes while the previous attempt is in flight', async () => {
    const request: ChatComposerRequest = {
      id: 'durable-quick-action',
      text: 'Summarize this canvas',
      submit: true,
    };
    let finishFirst!: (accepted: boolean) => void;
    const first = vi.fn(() => new Promise<boolean>(resolve => { finishFirst = resolve; }));
    const second = vi.fn(async () => true);
    const handled = vi.fn();
    const Probe = ({ ready }: { ready: boolean }) => {
      useComposerRequest({
        request,
        focusInput: vi.fn(),
        replaceInput: vi.fn(),
        submitQuickAction: ready ? second : first,
        onHandled: handled,
      });
      return null;
    };
    host = document.createElement('div');
    root = createRoot(host);
    await act(async () => root?.render(<Probe ready={false} />));
    await act(async () => root?.render(<Probe ready />));
    await act(async () => {
      finishFirst(false);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    expect(handled).toHaveBeenCalledWith('durable-quick-action');
  });
});
