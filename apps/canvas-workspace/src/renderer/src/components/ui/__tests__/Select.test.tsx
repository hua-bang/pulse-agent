// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Select, type SelectOption } from '../Select';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

const OPTIONS: SelectOption[] = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
  { value: 'c', label: 'Gamma' },
];

function render(node: React.ReactNode) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root?.render(node);
  });
}

const openMenu = (trigger: HTMLElement) => {
  act(() => {
    trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
};

describe('Select', () => {
  it('opens the menu on trigger click', () => {
    render(<Select value="a" options={OPTIONS} onChange={vi.fn()} ariaLabel="Choose" />);
    const trigger = host?.querySelector('.ui-select__trigger') as HTMLButtonElement;
    expect(host?.querySelector('.ui-select__menu')).toBeNull();

    openMenu(trigger);
    expect(host?.querySelector('.ui-select__menu')).not.toBeNull();
  });

  it('toggles aria-expanded on the trigger', () => {
    render(<Select value="a" options={OPTIONS} onChange={vi.fn()} ariaLabel="Choose" />);
    const trigger = host?.querySelector('.ui-select__trigger') as HTMLButtonElement;
    expect(trigger.getAttribute('aria-expanded')).toBe('false');

    openMenu(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
  });

  it('links the trigger to the listbox via aria-controls', () => {
    render(<Select value="a" options={OPTIONS} onChange={vi.fn()} ariaLabel="Choose" />);
    const trigger = host?.querySelector('.ui-select__trigger') as HTMLButtonElement;
    const controlsId = trigger.getAttribute('aria-controls');
    expect(controlsId).toBeTruthy();

    openMenu(trigger);
    const menu = host?.querySelector('.ui-select__menu') as HTMLElement;
    expect(menu.id).toBe(controlsId);
  });

  it('fires onChange and closes when an option is clicked', () => {
    const onChange = vi.fn();
    render(<Select value="a" options={OPTIONS} onChange={onChange} ariaLabel="Choose" />);
    const trigger = host?.querySelector('.ui-select__trigger') as HTMLButtonElement;
    openMenu(trigger);

    const options = Array.from(host?.querySelectorAll('.ui-select__option') ?? []);
    const beta = options.find((el) => el.textContent?.includes('Beta')) as HTMLElement;
    act(() => {
      beta.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    expect(onChange).toHaveBeenCalledWith('b');
    expect(host?.querySelector('.ui-select__menu')).toBeNull();
  });

  it('moves focus with ArrowDown/ArrowUp and selects the focused option on Enter', () => {
    const onChange = vi.fn();
    render(<Select value="a" options={OPTIONS} onChange={onChange} ariaLabel="Choose" />);
    const trigger = host?.querySelector('.ui-select__trigger') as HTMLButtonElement;
    openMenu(trigger);

    // Opening auto-focuses the active option (Alpha, since value="a").
    const alpha = Array.from(host?.querySelectorAll('.ui-select__option') ?? []).find((el) =>
      el.textContent?.includes('Alpha'),
    ) as HTMLElement;
    expect(document.activeElement).toBe(alpha);

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    });
    const beta = Array.from(host?.querySelectorAll('.ui-select__option') ?? []).find((el) =>
      el.textContent?.includes('Beta'),
    ) as HTMLElement;
    expect(document.activeElement).toBe(beta);

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
    });
    expect(document.activeElement).toBe(alpha);

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    });
    expect(document.activeElement).toBe(beta);

    // happy-dom does not implement the browser default action that turns a
    // focused <button>'s Enter keydown into a click, so Enter-selects is
    // exercised by invoking the resulting click directly on the focused
    // option — the same call the browser would make.
    act(() => {
      (document.activeElement as HTMLElement).dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      );
    });
    expect(onChange).toHaveBeenCalledWith('b');
    expect(host?.querySelector('.ui-select__menu')).toBeNull();
  });

  it('closes on Escape', () => {
    render(<Select value="a" options={OPTIONS} onChange={vi.fn()} ariaLabel="Choose" />);
    const trigger = host?.querySelector('.ui-select__trigger') as HTMLButtonElement;
    openMenu(trigger);
    expect(host?.querySelector('.ui-select__menu')).not.toBeNull();

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    expect(host?.querySelector('.ui-select__menu')).toBeNull();
  });

  it('shows the placeholder when value matches no option', () => {
    render(
      <Select value="zzz" options={OPTIONS} onChange={vi.fn()} ariaLabel="Choose" placeholder="Pick one" />,
    );
    const valueEl = host?.querySelector('.ui-select__value');
    expect(valueEl?.textContent).toBe('Pick one');
    expect(valueEl?.classList.contains('ui-select__value--placeholder')).toBe(true);
  });

  it('applies the top-placement class when menuPlacement="top"', () => {
    render(
      <Select value="a" options={OPTIONS} onChange={vi.fn()} ariaLabel="Choose" menuPlacement="top" />,
    );
    const trigger = host?.querySelector('.ui-select__trigger') as HTMLButtonElement;
    openMenu(trigger);
    const menu = host?.querySelector('.ui-select__menu');
    expect(menu?.classList.contains('ui-select__menu--top')).toBe(true);
  });
});
