// @vitest-environment happy-dom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { I18nProvider } from '../../../i18n';
import { Button } from '../Button';
import { Drawer } from '../Drawer';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

/** Self-closing harness — Drawer's own onClose flips internal state, like a
 *  typical host component would wire it. Drawer calls useI18n() unconditionally
 *  (for the default close-button label), so it must be wrapped in I18nProvider —
 *  there is no existing test precedent for this in the repo. The outside
 *  placeholder reuses the blessed Button rather than a raw tag. */
function SelfClosingDrawer({ initialOpen = true }: { initialOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  return (
    <I18nProvider>
      <Button data-testid="outside">Outside</Button>
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        kicker="Kicker"
        title="Title"
        ariaLabel="Drawer aria label"
      >
        <div data-testid="drawer-body">Body</div>
      </Drawer>
    </I18nProvider>
  );
}

function render(node: React.ReactNode) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root?.render(node);
  });
}

describe('Drawer', () => {
  it('closes on Escape', () => {
    render(<SelfClosingDrawer />);
    expect(document.querySelector('.ui-drawer')).not.toBeNull();

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    expect(document.querySelector('.ui-drawer')).toBeNull();
  });

  it('closes on a backdrop mousedown, but not on a mousedown inside the aside', () => {
    render(<SelfClosingDrawer />);

    const body = document.querySelector('[data-testid="drawer-body"]') as HTMLElement;
    act(() => {
      body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    });
    expect(document.querySelector('.ui-drawer')).not.toBeNull();

    const backdrop = document.querySelector('.ui-drawer-backdrop') as HTMLElement;
    act(() => {
      backdrop.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    });
    expect(document.querySelector('.ui-drawer')).toBeNull();
  });

  it('carries a dialog role and aria-modal on the aside', () => {
    render(<SelfClosingDrawer />);
    const aside = document.querySelector('.ui-drawer');
    expect(aside?.getAttribute('role')).toBe('dialog');
    expect(aside?.getAttribute('aria-modal')).toBe('true');
    expect(aside?.getAttribute('aria-label')).toBe('Drawer aria label');
  });

  it('gives the close button a non-empty aria-label', () => {
    render(<SelfClosingDrawer />);
    const closeBtn = document.querySelector('.ui-drawer-close');
    expect(closeBtn?.getAttribute('aria-label')).toBeTruthy();
  });

  it('merges a caller className onto the aside', () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root?.render(
        <I18nProvider>
          <Drawer
            open
            onClose={() => undefined}
            kicker="Kicker"
            title="Title"
            ariaLabel="Drawer aria label"
            className="workspace-settings-drawer"
          >
            <div>Body</div>
          </Drawer>
        </I18nProvider>,
      );
    });
    const aside = document.querySelector('.ui-drawer');
    expect(aside?.classList.contains('workspace-settings-drawer')).toBe(true);
  });
});
