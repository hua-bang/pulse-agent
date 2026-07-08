// @vitest-environment happy-dom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button } from '../Button';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

function render(node: ReactNode): HTMLButtonElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root?.render(node);
  });
  return host.querySelector('button') as HTMLButtonElement;
}

describe('Button', () => {
  it('defaults type to "button" when not specified', () => {
    const btn = render(<Button>Save</Button>);
    expect(btn.type).toBe('button');
  });

  it('respects an explicit type override', () => {
    const btn = render(<Button type="submit">Save</Button>);
    expect(btn.type).toBe('submit');
  });

  it('applies the variant and size classes', () => {
    const btn = render(
      <Button variant="primary" size="sm">
        Save
      </Button>,
    );
    expect(btn.classList.contains('ui-btn')).toBe(true);
    expect(btn.classList.contains('ui-btn--primary')).toBe(true);
    expect(btn.classList.contains('ui-btn--sm')).toBe(true);
  });

  it('defaults variant to secondary and size to md', () => {
    const btn = render(<Button>Save</Button>);
    expect(btn.classList.contains('ui-btn--secondary')).toBe(true);
    expect(btn.classList.contains('ui-btn--md')).toBe(true);
  });

  it('merges a caller className alongside the base classes', () => {
    const btn = render(<Button className="my-extra">Save</Button>);
    expect(btn.classList.contains('ui-btn')).toBe(true);
    expect(btn.classList.contains('my-extra')).toBe(true);
  });

  it('blocks onClick while disabled', () => {
    const onClick = vi.fn();
    const btn = render(
      <Button disabled onClick={onClick}>
        Save
      </Button>,
    );
    act(() => {
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(onClick).not.toHaveBeenCalled();
  });

  it('fires onClick when enabled', () => {
    const onClick = vi.fn();
    const btn = render(<Button onClick={onClick}>Save</Button>);
    act(() => {
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
