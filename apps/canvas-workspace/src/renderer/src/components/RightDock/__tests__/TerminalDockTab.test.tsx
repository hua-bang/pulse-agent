// @vitest-environment happy-dom
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TerminalDockTab } from '../TerminalDockTab';
import { getDockTabVisualState } from '../dock-tab-visual-state';
import type { DockTerminalTab } from '../dock-types';
import { I18nProvider } from '../../../i18n';

let root: Root | null = null;
let mount: HTMLDivElement | null = null;

afterEach(() => {
  flushSync(() => root?.unmount());
  mount?.remove();
  root = null;
  mount = null;
});

const tab: DockTerminalTab = { id: 'terminal-1', ordinal: 1 };

const renderTab = (onActivate: (id: string) => void) => {
  mount = document.createElement('div');
  document.body.appendChild(mount);
  root = createRoot(mount);
  flushSync(() => root?.render(
    <I18nProvider>
      <TerminalDockTab
        tab={tab}
        visual={getDockTabVisualState(tab.id, null, undefined)}
        registerTab={() => {}}
        onActivate={onActivate}
        onClose={() => {}}
        onRename={() => {}}
        onDragStart={() => {}}
        onDragOver={() => {}}
        onDrop={() => {}}
        onDragEnd={() => {}}
      />
    </I18nProvider>,
  ));
  return mount.querySelector<HTMLButtonElement>('.right-dock__tab')!;
};

describe('TerminalDockTab activation gestures', () => {
  it('activates on left mouse-down so a click swallowed by a drag still activates', () => {
    const onActivate = vi.fn();
    const button = renderTab(onActivate);
    button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    expect(onActivate).toHaveBeenCalledWith(tab.id);
  });

  it('ignores non-left mouse-down', () => {
    const onActivate = vi.fn();
    const button = renderTab(onActivate);
    button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 2 }));
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('keeps click activation for keyboard (Enter/Space) triggers', () => {
    const onActivate = vi.fn();
    const button = renderTab(onActivate);
    button.click();
    expect(onActivate).toHaveBeenCalledWith(tab.id);
  });
});
