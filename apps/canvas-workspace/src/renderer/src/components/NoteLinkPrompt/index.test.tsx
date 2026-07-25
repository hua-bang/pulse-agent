// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../i18n';
import { NoteLinkPrompt } from '.';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

const renderPrompt = (initial = '') => {
  const onApply = vi.fn();
  const onCancel = vi.fn();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);

  act(() => {
    root?.render(
      <I18nProvider>
        <NoteLinkPrompt initial={initial} onApply={onApply} onCancel={onCancel} />
      </I18nProvider>,
    );
  });

  return { onApply, onCancel };
};

describe('NoteLinkPrompt', () => {
  it('exposes localized group semantics and applies on Enter', () => {
    const { onApply } = renderPrompt('https://pulse.local');
    const dialog = host?.querySelector('[role="group"]');
    const input = host?.querySelector<HTMLInputElement>('input[aria-label="Link URL"]');

    expect(dialog?.getAttribute('aria-label')).toBe('Edit link');
    expect(document.activeElement).toBe(input);
    expect(input?.value).toBe('https://pulse.local');

    act(() => {
      input?.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
      }));
    });

    expect(onApply).toHaveBeenCalledWith('https://pulse.local');
  });

  it('cancels on Escape without stealing an active IME composition', () => {
    const { onCancel } = renderPrompt();
    const input = host?.querySelector<HTMLInputElement>('input[aria-label="Link URL"]');

    act(() => {
      input?.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
        isComposing: true,
      }));
    });
    expect(onCancel).not.toHaveBeenCalled();

    const escape = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    act(() => input?.dispatchEvent(escape));
    expect(escape.defaultPrevented).toBe(true);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('offers a remove action only when editing an existing link', () => {
    const { onApply } = renderPrompt('https://pulse.local');
    const remove = Array.from(host?.querySelectorAll('button') ?? [])
      .find((button) => button.textContent === 'Remove link');

    expect(remove).toBeTruthy();
    act(() => remove?.click());
    expect(onApply).toHaveBeenCalledWith('');
  });
});
