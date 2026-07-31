// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { WebviewContextMenuRequest } from '../../../../../shared/webview-context-menu';
import { usePageContextMenu } from '../usePageContextMenu';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
let listener: ((request: WebviewContextMenuRequest) => void) | null;

const request: WebviewContextMenuRequest = {
  sourceWebContentsId: 42,
  x: 10,
  y: 20,
  linkURL: '',
  srcURL: '',
  mediaType: 'none',
  selectionText: '',
  isEditable: false,
};

const Harness = ({ active }: { active: boolean }) => {
  const contextMenu = usePageContextMenu({ guestId: 42, active });
  return contextMenu.menu ? <div data-menu-open /> : null;
};

beforeEach(() => {
  listener = null;
  Object.defineProperty(window, 'canvasWorkspace', {
    configurable: true,
    value: {
      iframe: {
        onContextMenu: (next: typeof listener) => {
          listener = next;
          return () => { listener = null; };
        },
      },
    },
  });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('usePageContextMenu lifecycle', () => {
  it('closes and stops claiming guest menus as soon as its tab is hidden', () => {
    act(() => root.render(<Harness active />));
    act(() => listener?.(request));
    expect(host.querySelector('[data-menu-open]')).not.toBeNull();

    act(() => root.render(<Harness active={false} />));
    expect(host.querySelector('[data-menu-open]')).toBeNull();
    expect(listener).toBeNull();
  });
});
