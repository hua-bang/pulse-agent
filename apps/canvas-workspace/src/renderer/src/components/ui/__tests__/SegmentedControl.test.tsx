// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SegmentedControl } from '../SegmentedControl';

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
  { id: 'activity', label: 'Activity' },
  { id: 'terminal', label: 'Terminal' },
];

describe('SegmentedControl', () => {
  it('renders role=radiogroup with role=radio options by default', () => {
    render(<SegmentedControl options={OPTIONS} value="activity" onChange={vi.fn()} ariaLabel="Agent view" />);
    expect(host?.querySelector('[role="radiogroup"]')).not.toBeNull();
    const opts = host?.querySelectorAll('[role="radio"]');
    expect(opts?.length).toBe(2);
  });

  it('marks the active option aria-checked=true in radio pattern', () => {
    render(<SegmentedControl options={OPTIONS} value="terminal" onChange={vi.fn()} ariaLabel="Agent view" />);
    const opts = Array.from(host?.querySelectorAll('[role="radio"]') ?? []);
    const active = opts.find((el) => el.textContent === 'Terminal');
    const inactive = opts.find((el) => el.textContent === 'Activity');
    expect(active?.getAttribute('aria-checked')).toBe('true');
    expect(inactive?.getAttribute('aria-checked')).toBe('false');
    expect(active?.classList.contains('ui-segmented__option--active')).toBe(true);
  });

  it('renders role=tablist with role=tab/aria-selected when ariaPattern="tab"', () => {
    render(
      <SegmentedControl options={OPTIONS} value="activity" onChange={vi.fn()} ariaPattern="tab" ariaLabel="Agent view" />,
    );
    expect(host?.querySelector('[role="tablist"]')).not.toBeNull();
    const tabs = Array.from(host?.querySelectorAll('[role="tab"]') ?? []);
    expect(tabs.length).toBe(2);
    const active = tabs.find((el) => el.textContent === 'Activity');
    expect(active?.getAttribute('aria-selected')).toBe('true');
    // Tab pattern must not also carry aria-checked/role=radio.
    expect(host?.querySelector('[role="radio"]')).toBeNull();
  });

  it('fires onChange with the clicked option id', () => {
    const onChange = vi.fn();
    render(<SegmentedControl options={OPTIONS} value="activity" onChange={onChange} ariaLabel="Agent view" />);
    const terminalOption = Array.from(host?.querySelectorAll('[role="radio"]') ?? []).find(
      (el) => el.textContent === 'Terminal',
    ) as HTMLElement;
    act(() => {
      terminalOption.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(onChange).toHaveBeenCalledWith('terminal');
  });

  it('renders every option as type="button"', () => {
    render(<SegmentedControl options={OPTIONS} value="activity" onChange={vi.fn()} />);
    const buttons = Array.from(host?.querySelectorAll('button') ?? []) as HTMLButtonElement[];
    expect(buttons.every((btn) => btn.type === 'button')).toBe(true);
  });
});
