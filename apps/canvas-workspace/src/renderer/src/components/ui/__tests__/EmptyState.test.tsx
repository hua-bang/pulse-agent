// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { EmptyState } from '../EmptyState';

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

describe('EmptyState', () => {
  it('renders the title always, description/icon/action only when provided', () => {
    render(<EmptyState title="Nothing here" />);
    const rootEl = host?.querySelector('.ui-emptystate') as HTMLElement;
    expect(rootEl.querySelector('.ui-emptystate__title')?.textContent).toBe('Nothing here');
    expect(rootEl.querySelector('.ui-emptystate__icon')).toBeNull();
    expect(rootEl.querySelector('.ui-emptystate__desc')).toBeNull();
    expect(rootEl.querySelector('.ui-emptystate__action')).toBeNull();
  });

  it('renders icon, description, and action when provided, in order', () => {
    render(
      <EmptyState
        icon={<svg data-testid="icon" />}
        title="No pinned references"
        description="Pin a node to see it here."
        action={<button type="button">Retry</button>}
      />,
    );
    const rootEl = host?.querySelector('.ui-emptystate') as HTMLElement;
    const classNames = Array.from(rootEl.children).map((el) => el.className);
    expect(classNames).toEqual([
      'ui-emptystate__icon',
      'ui-emptystate__title',
      'ui-emptystate__desc',
      'ui-emptystate__action',
    ]);
    expect(rootEl.querySelector('[data-testid="icon"]')).not.toBeNull();
    expect(rootEl.querySelector('.ui-emptystate__desc')?.textContent).toBe('Pin a node to see it here.');
    expect(rootEl.querySelector('.ui-emptystate__action button')?.textContent).toBe('Retry');
  });

  it('merges className onto the root wrapper', () => {
    render(<EmptyState className="reference-empty" title="Empty" />);
    expect(host?.querySelector('.ui-emptystate')?.classList.contains('reference-empty')).toBe(true);
  });

  it('accepts ReactNode title/description, not just strings', () => {
    render(<EmptyState title={<span>Rich title</span>} description={<em>Rich description</em>} />);
    expect(host?.querySelector('.ui-emptystate__title span')?.textContent).toBe('Rich title');
    expect(host?.querySelector('.ui-emptystate__desc em')?.textContent).toBe('Rich description');
  });
});
