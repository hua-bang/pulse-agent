// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { FieldRow } from '../FieldRow';

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

describe('FieldRow', () => {
  it('renders the label above the children', () => {
    render(
      <FieldRow label="Root folder">
        <button type="button">Pick</button>
      </FieldRow>,
    );
    const rootEl = host?.querySelector('.ui-fieldrow') as HTMLElement;
    expect(rootEl.children[0].className).toBe('ui-fieldrow__label');
    expect(rootEl.children[0].textContent).toBe('Root folder');
    expect(rootEl.querySelector('button')?.textContent).toBe('Pick');
  });

  it('renders the hint below the children', () => {
    render(
      <FieldRow label="Root folder" hint="Used for saved files">
        <button type="button">Pick</button>
      </FieldRow>,
    );
    const rootEl = host?.querySelector('.ui-fieldrow') as HTMLElement;
    expect(rootEl.children[rootEl.children.length - 1].className).toBe('ui-fieldrow__hint');
    expect(host?.querySelector('.ui-fieldrow__hint')?.textContent).toBe('Used for saved files');
  });

  it('omits label/hint elements when not provided', () => {
    render(
      <FieldRow>
        <span>content</span>
      </FieldRow>,
    );
    expect(host?.querySelector('.ui-fieldrow__label')).toBeNull();
    expect(host?.querySelector('.ui-fieldrow__hint')).toBeNull();
  });

  it('merges className onto the root wrapper', () => {
    render(
      <FieldRow className="language-section-field">
        <span>content</span>
      </FieldRow>,
    );
    expect(host?.querySelector('.ui-fieldrow')?.classList.contains('language-section-field')).toBe(true);
  });
});
