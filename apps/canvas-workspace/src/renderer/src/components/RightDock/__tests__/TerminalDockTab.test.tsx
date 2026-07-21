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

const renderTab = (onActivate: (id: string) => void, overrides?: Partial<DockTerminalTab>) => {
  mount = document.createElement('div');
  document.body.appendChild(mount);
  root = createRoot(mount);
  const renderedTab = { ...tab, ...overrides };
  flushSync(() => root?.render(
    <I18nProvider>
      <TerminalDockTab
        tab={renderedTab}
        visual={getDockTabVisualState(renderedTab.id, null, undefined)}
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

describe('TerminalDockTab agent-aware default title', () => {
  it('shows "Terminal {ordinal}" when no agent is running', () => {
    const button = renderTab(vi.fn());
    expect(button.textContent).toContain('Terminal 1');
  });

  it('shows "Claude {ordinal}" for claude-code agent type', () => {
    const button = renderTab(vi.fn(), { agentType: 'claude-code' });
    expect(button.textContent).toContain('Claude 1');
    expect(button.textContent).not.toContain('Terminal 1');
  });

  it('shows "Codex {ordinal}" for codex agent type', () => {
    const button = renderTab(vi.fn(), { agentType: 'codex' });
    expect(button.textContent).toContain('Codex 1');
    expect(button.textContent).not.toContain('Terminal 1');
  });

  it('respects a user-defined title over the agent default', () => {
    const button = renderTab(vi.fn(), { agentType: 'claude-code', title: 'My Session' });
    expect(button.textContent).toContain('My Session');
    expect(button.textContent).not.toContain('Claude 1');
  });
});
