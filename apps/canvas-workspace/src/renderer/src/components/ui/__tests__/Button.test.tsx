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
  it('forwards ref to the underlying <button>', () => {
    const ref = { current: null as HTMLButtonElement | null };
    const el = render(<Button ref={ref}>Go</Button>);
    expect(ref.current).toBe(el);
  });

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

  it('applies the xs size class for a text variant', () => {
    const btn = render(
      <Button variant="primary" size="xs">
        Save
      </Button>,
    );
    expect(btn.classList.contains('ui-btn--xs')).toBe(true);
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

  describe('icon variant', () => {
    it('applies the icon variant class', () => {
      const btn = render(<Button variant="icon" aria-label="Reload">↻</Button>);
      expect(btn.classList.contains('ui-btn--icon')).toBe(true);
    });

    it('sizes xs/sm/md/lg to 22/24/28/32px via the size classes', () => {
      const xs = render(<Button variant="icon" size="xs" aria-label="Reload">↻</Button>);
      expect(xs.classList.contains('ui-btn--xs')).toBe(true);

      const sm = render(<Button variant="icon" size="sm" aria-label="Reload">↻</Button>);
      expect(sm.classList.contains('ui-btn--sm')).toBe(true);

      const md = render(<Button variant="icon" aria-label="Reload">↻</Button>);
      expect(md.classList.contains('ui-btn--md')).toBe(true);

      const lg = render(<Button variant="icon" size="lg" aria-label="Reload">↻</Button>);
      expect(lg.classList.contains('ui-btn--lg')).toBe(true);
    });

    it('passes an explicit aria-label through', () => {
      const btn = render(<Button variant="icon" aria-label="Reload">↻</Button>);
      expect(btn.getAttribute('aria-label')).toBe('Reload');
    });
  });
});
