// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SwatchRow } from '../SwatchRow';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

function render(node: React.ReactNode) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root?.render(node);
  });
}

const OPTIONS = [
  { value: '#e5484d', label: 'Red' },
  { value: '#30a46c', label: 'Green' },
  { value: 'transparent', label: 'None', isNone: true },
];

describe('SwatchRow', () => {
  it('renders role=group with role=menuitemradio swatches by default', () => {
    render(<SwatchRow options={OPTIONS} value="#e5484d" onChange={vi.fn()} ariaLabel="Color" />);
    expect(host?.querySelector('[role="group"]')?.getAttribute('aria-label')).toBe('Color');
    const swatches = host?.querySelectorAll('[role="menuitemradio"]');
    expect(swatches?.length).toBe(3);
  });

  it('marks the active option aria-checked=true and data-menu-autofocus', () => {
    render(<SwatchRow options={OPTIONS} value="#30a46c" onChange={vi.fn()} />);
    const swatches = Array.from(host?.querySelectorAll('[role="menuitemradio"]') ?? []);
    const active = swatches.find((el) => el.getAttribute('aria-label') === 'Green') as HTMLElement;
    const inactive = swatches.find((el) => el.getAttribute('aria-label') === 'Red') as HTMLElement;
    expect(active.getAttribute('aria-checked')).toBe('true');
    expect(active.classList.contains('ui-swatchrow__swatch--active')).toBe(true);
    expect(active.getAttribute('data-menu-autofocus')).toBe('true');
    expect(inactive.getAttribute('aria-checked')).toBe('false');
    expect(inactive.hasAttribute('data-menu-autofocus')).toBe(false);
  });

  it('paints the swatch background from value, except for isNone options', () => {
    render(<SwatchRow options={OPTIONS} value="#e5484d" onChange={vi.fn()} />);
    const swatches = Array.from(host?.querySelectorAll('button') ?? []) as HTMLButtonElement[];
    const red = swatches.find((el) => el.getAttribute('aria-label') === 'Red')!;
    const none = swatches.find((el) => el.getAttribute('aria-label') === 'None')!;
    expect(red.style.background).toContain('#e5484d');
    expect(none.style.background).toBe('');
    expect(none.classList.contains('ui-swatchrow__swatch--none')).toBe(true);
  });

  it('fires onChange with the clicked option value and stops propagation', () => {
    const onChange = vi.fn();
    const onParentClick = vi.fn();
    render(
      <div onClick={onParentClick}>
        <SwatchRow options={OPTIONS} value="#e5484d" onChange={onChange} />
      </div>,
    );
    const green = Array.from(host?.querySelectorAll('button') ?? []).find(
      (el) => el.getAttribute('aria-label') === 'Green',
    ) as HTMLButtonElement;
    act(() => {
      green.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(onChange).toHaveBeenCalledWith('#30a46c');
    expect(onParentClick).not.toHaveBeenCalled();
  });

  it('renders aria-pressed toggle buttons when ariaPattern="toggle"', () => {
    render(<SwatchRow options={OPTIONS} value="#e5484d" onChange={vi.fn()} ariaPattern="toggle" />);
    expect(host?.querySelector('[role="menuitemradio"]')).toBeNull();
    const buttons = Array.from(host?.querySelectorAll('button') ?? []) as HTMLButtonElement[];
    expect(buttons.length).toBe(3);
    const active = buttons.find((el) => el.getAttribute('aria-label') === 'Red');
    expect(active?.getAttribute('aria-pressed')).toBe('true');
  });

  it('renders every swatch as type="button"', () => {
    render(<SwatchRow options={OPTIONS} value="#e5484d" onChange={vi.fn()} />);
    const buttons = Array.from(host?.querySelectorAll('button') ?? []) as HTMLButtonElement[];
    expect(buttons.every((btn) => btn.type === 'button')).toBe(true);
  });
});
