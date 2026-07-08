// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { Portal } from '../Portal';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe('Portal', () => {
  it('renders its children into document.body rather than the local host', () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);

    act(() => {
      root?.render(
        <Portal>
          <div data-testid="portal-child">hello</div>
        </Portal>,
      );
    });

    const child = document.body.querySelector('[data-testid="portal-child"]');
    expect(child).toBeInstanceOf(HTMLElement);
    expect(host.contains(child)).toBe(false);
    expect(document.body.contains(child)).toBe(true);
  });
});
