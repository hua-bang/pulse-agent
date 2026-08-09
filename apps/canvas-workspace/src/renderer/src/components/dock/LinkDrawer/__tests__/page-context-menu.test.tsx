// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../i18n';
import { PageContextMenu, type PageContextMenuActions } from '../PageContextMenu';
import { usePageContextMenu } from '../usePageContextMenu';
import type { WebviewContextMenuRequest } from '../../../../../../shared/webview-context-menu';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let mount: HTMLDivElement | null = null;
let contextMenuListener: ((request: WebviewContextMenuRequest) => void) | null = null;

const actions = (): PageContextMenuActions => ({
  openLink: vi.fn(),
  openExternal: vi.fn(),
  copyText: vi.fn(),
  goBack: vi.fn(),
  goForward: vi.fn(),
  reload: vi.fn(),
});

const request = (overrides: Partial<WebviewContextMenuRequest> = {}): WebviewContextMenuRequest => ({
  sourceWebContentsId: 1,
  x: 10,
  y: 10,
  linkURL: '',
  srcURL: '',
  mediaType: 'none',
  selectionText: '',
  isEditable: false,
  ...overrides,
});

const render = (
  req: WebviewContextMenuRequest,
  menuActions: PageContextMenuActions,
  onClose = vi.fn(),
  onRestorePageFocus = vi.fn(),
) => {
  act(() => root?.render(
    <I18nProvider>
      <PageContextMenu
        request={req}
        x={0}
        y={0}
        canGoBack
        canGoForward={false}
        pageUrl="https://example.com/page"
        actions={menuActions}
        onClose={onClose}
        onRestorePageFocus={onRestorePageFocus}
      />
    </I18nProvider>,
  ));
  return { onClose, onRestorePageFocus };
};

const labels = (): string[] => [...document.querySelectorAll('.context-menu-item')]
  .map((item) => item.textContent ?? '');

const clickLabel = (text: string) => {
  const item = [...document.querySelectorAll<HTMLButtonElement>('.context-menu-item')]
    .find((element) => element.textContent?.includes(text));
  if (!item) throw new Error(`no menu item matching "${text}" in [${labels().join(' | ')}]`);
  act(() => item.click());
};

beforeEach(() => {
  contextMenuListener = null;
  Object.defineProperty(window, 'canvasWorkspace', {
    configurable: true,
    value: {
      iframe: {
        onContextMenu: vi.fn((listener: (request: WebviewContextMenuRequest) => void) => {
          contextMenuListener = listener;
          return vi.fn();
        }),
      },
    },
  });
  mount = document.createElement('div');
  document.body.appendChild(mount);
  root = createRoot(mount);
});

afterEach(() => {
  act(() => root?.unmount());
  mount?.remove();
  root = null;
  mount = null;
});

const ContextMenuPlacementHarness = ({ guestId }: { guestId: number }) => {
  const { menu } = usePageContextMenu({ guestId });
  return menu ? <output data-x={menu.x} data-y={menu.y} /> : null;
};

describe('usePageContextMenu', () => {
  it('keeps Electron context-menu coordinates in the host viewport coordinate space', () => {
    act(() => root?.render(<ContextMenuPlacementHarness guestId={7} />));

    act(() => contextMenuListener?.(request({
      sourceWebContentsId: 7,
      x: 809,
      y: 222,
    })));

    const output = document.querySelector('output');
    expect(output?.dataset.x).toBe('809');
    expect(output?.dataset.y).toBe('222');
  });
});

describe('PageContextMenu', () => {
  it('offers page actions only when the click hit no link, image or selection', () => {
    render(request(), actions());
    const text = labels().join(' | ');

    expect(text).toContain('Reload');
    expect(text).toContain('Copy page address');
    expect(text).not.toContain('Copy link address');
    expect(text).not.toContain('Copy image address');
    // canGoForward is false, so Forward must not be offered as a dead entry.
    expect(text).not.toContain('Forward');
    expect(text).toContain('Back');
  });

  it('marks itself as dock-anchored so it is not painted behind the dock', () => {
    // It portals to body, which is a LOWER stacking context than the dock
    // (--layer-dock). Found on a real run: the menu was in the DOM, correctly
    // positioned, and invisible.
    render(request(), actions());
    expect(document.querySelector('.context-menu--in-dock')).not.toBeNull();
  });

  it('opens a link in a foreground or background tab as chosen', () => {
    const menuActions = actions();
    render(request({ linkURL: 'https://example.com/target' }), menuActions);

    clickLabel('Open link in new tab');
    expect(menuActions.openLink).toHaveBeenCalledWith('https://example.com/target');

    render(request({ linkURL: 'https://example.com/target' }), menuActions);
    clickLabel('Open link in background tab');
    expect(menuActions.openLink).toHaveBeenLastCalledWith('https://example.com/target', { background: true });
  });

  it('searches a selection on the configured engine, with a capped label', () => {
    const menuActions = actions();
    const selectionText = 'a very long selection that would otherwise overflow the menu row';
    render(request({ selectionText }), menuActions);

    // Untrusted page text must not be able to stretch the menu.
    const searchRow = labels().find((label) => label.startsWith('Search for'));
    expect(searchRow).toBe('Search for “a very long selection th…”');

    clickLabel('Search for');
    expect(menuActions.openLink).toHaveBeenCalledWith(
      `https://www.google.com/search?q=${encodeURIComponent(selectionText)}`,
    );
  });

  it('treats a URL-shaped selection as a URL, matching the address bar', () => {
    const menuActions = actions();
    render(request({ selectionText: 'example.org/docs' }), menuActions);

    clickLabel('Search for');
    expect(menuActions.openLink).toHaveBeenCalledWith('https://example.org/docs');
  });

  it('offers image entries for an image target', () => {
    const menuActions = actions();
    render(request({ mediaType: 'image', srcURL: 'https://cdn.example.com/a.png' }), menuActions);

    clickLabel('Copy image address');
    expect(menuActions.copyText).toHaveBeenCalledWith('https://cdn.example.com/a.png');
  });

  it('closes after any action, so the menu never outlives its click', () => {
    const menuActions = actions();
    const copyText = vi.mocked(menuActions.copyText);
    const { onClose, onRestorePageFocus } = render(
      request({ linkURL: 'https://example.com/x' }),
      menuActions,
    );

    clickLabel('Copy link address');
    expect(onClose).toHaveBeenCalledOnce();
    expect(copyText).toHaveBeenCalledWith('https://example.com/x');
    expect(onRestorePageFocus).toHaveBeenCalledOnce();
    expect(copyText.mock.invocationCallOrder[0])
      .toBeLessThan(onRestorePageFocus.mock.invocationCallOrder[0]);
  });

  it('restores page focus when Escape deliberately dismisses the menu', () => {
    const { onClose, onRestorePageFocus } = render(request(), actions());

    act(() => {
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
      }));
    });

    expect(onClose).toHaveBeenCalledOnce();
    expect(onRestorePageFocus).toHaveBeenCalledOnce();
  });

  it('does not steal focus back when an outside press dismisses the menu', () => {
    const { onClose, onRestorePageFocus } = render(request(), actions());

    act(() => {
      mount?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });

    expect(onClose).toHaveBeenCalledOnce();
    expect(onRestorePageFocus).not.toHaveBeenCalled();
  });

  it('leaves focus ownership to a foreground tab opened from the menu', () => {
    const menuActions = actions();
    const { onRestorePageFocus } = render(
      request({ linkURL: 'https://example.com/next' }),
      menuActions,
    );

    clickLabel('Open link in new tab');

    expect(menuActions.openLink).toHaveBeenCalledWith('https://example.com/next');
    expect(onRestorePageFocus).not.toHaveBeenCalled();
  });

  it('restores the source page after opening a background tab', () => {
    const menuActions = actions();
    const { onRestorePageFocus } = render(
      request({ linkURL: 'https://example.com/later' }),
      menuActions,
    );

    clickLabel('Open link in background tab');

    expect(menuActions.openLink).toHaveBeenCalledWith(
      'https://example.com/later',
      { background: true },
    );
    expect(onRestorePageFocus).toHaveBeenCalledOnce();
  });
});
