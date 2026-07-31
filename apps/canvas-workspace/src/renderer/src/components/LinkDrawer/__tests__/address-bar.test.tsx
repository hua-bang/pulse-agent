// @vitest-environment happy-dom
import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAddressBar } from '../useAddressBar';
import {
  consumeDockPageFocusRequest,
  requestDockPageFocus,
} from '../../RightDock/dock-browser-commands';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let mount: HTMLDivElement | null = null;
const onNavigate = vi.fn();

const Harness = ({
  url,
  currentUrl,
  active,
}: {
  url: string;
  currentUrl: string;
  active: boolean;
}) => {
  const pageRef = useRef<HTMLButtonElement>(null);
  const bar = useAddressBar({
    active,
    url,
    currentUrl,
    onNavigate,
    onRestorePageFocus: () => pageRef.current?.focus(),
  });
  return (
    <>
      <form ref={bar.formRef} onSubmit={bar.onSubmit}>
        <input
          value={bar.address}
          onChange={(event) => bar.onChange(event.target.value)}
          onFocus={(event) => bar.onFocus(event.currentTarget)}
          onBlur={bar.onBlur}
          onKeyDown={bar.onKeyDown}
        />
      </form>
      <button ref={pageRef} data-page type="button">Page</button>
    </>
  );
};

const render = (url: string, currentUrl = url, active = true) => {
  act(() => root?.render(<Harness url={url} currentUrl={currentUrl} active={active} />));
  return mount?.querySelector('input') as HTMLInputElement;
};

const input = () => mount?.querySelector('input') as HTMLInputElement;
const page = () => mount?.querySelector('[data-page]') as HTMLButtonElement;

// React tracks the last value it wrote; assigning `.value` directly makes its
// tracker believe nothing changed and swallows the synthetic change event.
const nativeValueSetter = Object.getOwnPropertyDescriptor(
  HTMLInputElement.prototype,
  'value',
)?.set as (this: HTMLInputElement, value: string) => void;

const type = (element: HTMLInputElement, value: string) => {
  act(() => {
    nativeValueSetter.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

// React 17+ delegates onFocus/onBlur to focusin/focusout at the root.
const focus = (element: HTMLInputElement) => {
  act(() => {
    element.focus();
    element.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
  });
};

const blur = (element: HTMLInputElement) => {
  act(() => {
    element.blur();
    element.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  });
};

beforeEach(() => {
  onNavigate.mockReset();
  Object.defineProperty(window, 'canvasWorkspace', {
    configurable: true,
    value: { history: { search: () => Promise.resolve([]) } },
  });
  mount = document.createElement('div');
  document.body.appendChild(mount);
  root = createRoot(mount);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});

afterEach(() => {
  act(() => root?.unmount());
  mount?.remove();
  root = null;
  mount = null;
  vi.unstubAllGlobals();
});

describe('useAddressBar', () => {
  it('adopts external navigation while the user is not editing', () => {
    expect(render('https://a.example/').value).toBe('https://a.example/');

    render('https://b.example/');
    expect(input().value).toBe('https://b.example/');
  });

  it('does not overwrite what the user is typing when the page navigates', () => {
    // A redirect, an SPA pushState, or a late analytics hop used to wipe the
    // half-typed address out from under the cursor mid-keystroke.
    const field = render('https://a.example/');
    focus(field);
    type(field, 'my new sear');
    expect(input().value).toBe('my new sear');

    // The guest navigates underneath the edit…
    render('https://a.example/redirected', 'https://a.example/redirected');
    expect(input().value).toBe('my new sear');

    // …and the field re-adopts the live URL once the edit ends.
    blur(input());
    expect(input().value).toBe('https://a.example/redirected');
  });

  it('resolves typed input on submit and hands focus back to the page', () => {
    const field = render('https://a.example/');
    focus(field);
    type(field, 'example.org/docs');
    act(() => {
      mount?.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    expect(onNavigate).toHaveBeenCalledWith('https://example.org/docs');
    expect(document.activeElement).toBe(page());
  });

  it('abandons the edit on Escape and restores the live URL', () => {
    const field = render('https://a.example/');
    focus(field);
    type(field, 'half typed');

    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    act(() => { input().dispatchEvent(escape); });

    expect(input().value).toBe('https://a.example/');
    // The dock's Escape handler must not also act on this key.
    expect(escape.defaultPrevented).toBe(true);
    expect(onNavigate).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(page());
  });

  it('only auto-focuses a blank omnibox while its tab is active', () => {
    const field = render('', '', false);
    expect(document.activeElement).not.toBe(field);

    render('', '', true);
    expect(document.activeElement).toBe(input());

    render('', '', false);
    expect(document.activeElement).not.toBe(input());
  });

  it('does not steal focus back after the user leaves a blank omnibox', () => {
    render('', '', true);
    expect(document.activeElement).toBe(input());

    act(() => {
      page().focus();
      input().dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });

    expect(document.activeElement).toBe(page());
  });

  it('cancels an older pending page-focus request when the user enters the omnibox', () => {
    const field = render('https://a.example/');
    requestDockPageFocus({ workspaceId: 'ws-a', tabId: 'cold-tab' });

    focus(field);

    expect(consumeDockPageFocusRequest({ workspaceId: 'ws-a', tabId: 'cold-tab' })).toBe(false);
  });
});
