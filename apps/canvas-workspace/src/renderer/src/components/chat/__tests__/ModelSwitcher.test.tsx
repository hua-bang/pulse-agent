// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../i18n';
import { ModelSwitcher } from '../ModelSwitcher';
import type { CanvasModelStatus } from '../../../types';
import type { ModelSelection } from '../modelSettingsTypes';

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

const STATUS: CanvasModelStatus = {
  path: '/config',
  currentProvider: 'anthropic',
  currentModel: 'claude',
  providerType: 'claude',
  resolvedModel: 'claude-sonnet',
  apiKeyPresent: true,
  options: [],
  providers: [
    {
      id: 'anthropic',
      name: 'Anthropic',
      provider_type: 'claude',
      apiKeyPresent: true,
      models: [
        { id: 'claude-sonnet', name: 'Claude Sonnet' },
        { id: 'claude-opus', name: 'Claude Opus' },
      ],
    },
  ],
};

const AUTO_SELECTION: ModelSelection = { mode: 'auto' };
const MODEL_SELECTION: ModelSelection = { mode: 'model', providerId: 'anthropic', modelId: 'claude-sonnet' };

function renderSwitcher(overrides: Partial<Parameters<typeof ModelSwitcher>[0]> = {}) {
  const onSelectAuto = vi.fn().mockResolvedValue(undefined);
  const onSelectModel = vi.fn().mockResolvedValue(undefined);
  const onOpenSettings = vi.fn();
  render(
    <I18nProvider>
      <ModelSwitcher
        status={STATUS}
        selection={AUTO_SELECTION}
        label="Auto"
        onSelectAuto={onSelectAuto}
        onSelectModel={onSelectModel}
        onOpenSettings={onOpenSettings}
        {...overrides}
      />
    </I18nProvider>,
  );
  return { onSelectAuto, onSelectModel, onOpenSettings };
}

/**
 * Re-shelled onto ui/Popover's new `anchorRef` rect-anchoring mode (Popover
 * rect-anchoring batch — see ui-reuse-burndown.md). These specs pin the
 * behavior the migration had to preserve by hand (the Escape-vs-outside
 * focus-restore split, and the anchor/trigger click-outside exemption) plus
 * what Popover now provides for free (portal, reanchoring, Escape,
 * arrow-nav, outside-press).
 */
describe('ModelSwitcher', () => {
  it('opens on trigger click and lists Auto plus each provider\'s models', () => {
    renderSwitcher();
    expect(document.querySelector('.chat-model-menu')).toBeNull();
    const trigger = host!.querySelector('.chat-model-switcher-btn') as HTMLButtonElement;
    act(() => {
      trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    const items = document.querySelectorAll('.chat-model-menu-item');
    // Auto + 2 provider models.
    expect(items.length).toBe(3);
    expect(items[0].textContent).toContain('Auto');
  });

  it('Popover portals the menu to document.body, not inside the switcher', () => {
    renderSwitcher();
    const trigger = host!.querySelector('.chat-model-switcher-btn') as HTMLButtonElement;
    act(() => {
      trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(host?.querySelector('.chat-model-menu')).toBeNull();
    expect(document.querySelector('.chat-model-menu')).not.toBeNull();
  });

  it('selecting a model calls onSelectModel and closes the menu', () => {
    const { onSelectModel } = renderSwitcher();
    const trigger = host!.querySelector('.chat-model-switcher-btn') as HTMLButtonElement;
    act(() => {
      trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    const modelItem = document.querySelectorAll('.chat-model-menu-item--model')[1] as HTMLElement;
    act(() => {
      modelItem.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(onSelectModel).toHaveBeenCalledWith('anthropic', 'claude-opus');
    expect(document.querySelector('.chat-model-menu')).toBeNull();
  });

  it('closes on Escape and restores focus to the trigger', () => {
    renderSwitcher();
    const trigger = host!.querySelector('.chat-model-switcher-btn') as HTMLButtonElement;
    act(() => {
      trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(document.querySelector('.chat-model-menu')).not.toBeNull();

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    expect(document.querySelector('.chat-model-menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('does NOT restore focus to the trigger on an outside-press close', () => {
    renderSwitcher();
    const trigger = host!.querySelector('.chat-model-switcher-btn') as HTMLButtonElement;
    act(() => {
      trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(document.querySelector('.chat-model-menu')).not.toBeNull();
    trigger.blur();

    act(() => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    });
    expect(document.querySelector('.chat-model-menu')).toBeNull();
    expect(document.activeElement).not.toBe(trigger);
  });

  it('clicking the open trigger closes the menu (does not double-fire into staying open)', () => {
    // Regression pin for the anchor/trigger click-outside exemption fixed
    // in ui/Popover: without it, a press on the trigger while open would
    // race an outside-close against the trigger's own toggle handler in the
    // same click gesture and net out to STILL OPEN — see Popover/index.tsx's
    // own comment on this.
    renderSwitcher();
    const trigger = host!.querySelector('.chat-model-switcher-btn') as HTMLButtonElement;
    act(() => {
      trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(document.querySelector('.chat-model-menu')).not.toBeNull();

    act(() => {
      trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(document.querySelector('.chat-model-menu')).toBeNull();
  });

  it('ArrowDown on the closed trigger opens the menu', () => {
    renderSwitcher();
    const trigger = host!.querySelector('.chat-model-switcher-btn') as HTMLButtonElement;
    act(() => {
      trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    });
    expect(document.querySelector('.chat-model-menu')).not.toBeNull();
  });

  it('autofocuses the active selection\'s menu item on open (Popover\'s data-menu-autofocus marker)', () => {
    renderSwitcher({ selection: MODEL_SELECTION, label: 'Claude Sonnet' });
    const trigger = host!.querySelector('.chat-model-switcher-btn') as HTMLButtonElement;
    act(() => {
      trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    const active = document.querySelector('.chat-model-menu-item--active') as HTMLElement;
    expect(active.getAttribute('data-menu-autofocus')).toBe('true');
    expect(document.activeElement).toBe(active);
  });

  it('wires aria-haspopup/aria-expanded/aria-controls to the portaled panel\'s id', () => {
    renderSwitcher();
    const trigger = host!.querySelector('.chat-model-switcher-btn') as HTMLButtonElement;
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(trigger.hasAttribute('aria-controls')).toBe(false);

    act(() => {
      trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const panel = document.querySelector('.chat-model-menu') as HTMLElement;
    expect(trigger.getAttribute('aria-controls')).toBe(panel.id);
    expect(panel.getAttribute('aria-label')).toBe('Use model');
    expect(panel.getAttribute('role')).toBe('menu');
  });

  it('when not configured, the trigger opens settings instead of the menu', () => {
    const { onOpenSettings } = renderSwitcher({
      status: { ...STATUS, apiKeyPresent: false },
    });
    const trigger = host!.querySelector('.chat-model-switcher-btn') as HTMLButtonElement;
    act(() => {
      trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.chat-model-menu')).toBeNull();
  });
});
