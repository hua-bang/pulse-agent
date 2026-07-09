// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { SectionHeader } from '../SectionHeader';

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

describe('SectionHeader', () => {
  it('renders the title', () => {
    render(<SectionHeader title="Updates" />);
    expect(host?.querySelector('.ui-section-header__title')?.textContent).toBe('Updates');
  });

  it('renders the description when provided', () => {
    render(<SectionHeader title="Updates" description="Keep the app current" />);
    expect(host?.querySelector('.ui-section-header__description')?.textContent).toBe('Keep the app current');
  });

  it('omits the description element when not provided', () => {
    render(<SectionHeader title="Updates" />);
    expect(host?.querySelector('.ui-section-header__description')).toBeNull();
  });

  it('merges className onto the root wrapper', () => {
    render(<SectionHeader title="Updates" className="updates-section-intro" />);
    const root = host?.querySelector('.ui-section-header');
    expect(root?.classList.contains('updates-section-intro')).toBe(true);
  });
});
