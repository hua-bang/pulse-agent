// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../../i18n';
import { ModelSwitcher } from '../index';
import type { CanvasModelStatus, ModelSelection } from '../../../../../types';

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
const MULTI_PROVIDER_STATUS: CanvasModelStatus = {
  ...STATUS,
  providers: [
    ...STATUS.providers,
    {
      id: 'openai',
      name: 'OpenAI',
      provider_type: 'openai',
      apiKeyPresent: true,
      models: [
        { id: 'gpt-4o', name: 'GPT-4o' },
        { id: 'gpt-4o-mini' },
      ],
    },
  ],
};

function renderSwitcher(overrides: Partial<Parameters<typeof ModelSwitcher>[0]> = {}) {
  const onSelectModel = vi.fn().mockResolvedValue(undefined);
  const onOpenSettings = vi.fn();
  render(
    <I18nProvider>
      <ModelSwitcher
        status={STATUS}
        selection={AUTO_SELECTION}
        label="Auto"
        onSelectModel={onSelectModel}
        onOpenSettings={onOpenSettings}
        {...overrides}
      />
    </I18nProvider>,
  );
  return { onSelectModel, onOpenSettings };
}

function openMenu() {
  const trigger = host!.querySelector('.chat-model-switcher-btn') as HTMLButtonElement;
  act(() => {
    trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  return trigger;
}

function typeInSearch(value: string) {
  const search = document.querySelector('.chat-model-menu-search input') as HTMLInputElement;
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(search, value);
    search.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return search;
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
  it('opens on trigger click and lists each provider\'s models, with no Auto entry', () => {
    renderSwitcher();
    expect(document.querySelector('.chat-model-menu')).toBeNull();
    openMenu();
    const items = document.querySelectorAll('.chat-model-menu-item');
    expect(items.length).toBe(2);
    expect(Array.from(items).every((item) => item.classList.contains('chat-model-menu-item--model'))).toBe(true);
    expect(document.querySelector('.chat-model-menu')?.textContent).not.toContain('Auto');
  });

  it('filters the list by model name, id, or provider name', () => {
    renderSwitcher();
    openMenu();

    typeInSearch('opus');
    let titles = Array.from(document.querySelectorAll('.chat-model-menu-title')).map((n) => n.textContent);
    expect(titles).toEqual(['Claude Opus']);

    // Model id, not the display name.
    typeInSearch('claude-sonnet');
    titles = Array.from(document.querySelectorAll('.chat-model-menu-title')).map((n) => n.textContent);
    expect(titles).toEqual(['Claude Sonnet']);

    // A provider-name hit keeps that provider's whole catalog.
    typeInSearch('anthropic');
    expect(document.querySelectorAll('.chat-model-menu-item--model').length).toBe(2);

    typeInSearch('nothing-matches-this');
    expect(document.querySelectorAll('.chat-model-menu-item--model').length).toBe(0);
    expect(document.querySelector('.chat-model-menu-empty')?.textContent).toBe('No matching models');
  });

  it('filters a long catalog by provider and avoids repeating a bare model id', () => {
    renderSwitcher({ status: MULTI_PROVIDER_STATUS });
    openMenu();

    expect(document.querySelector('.chat-model-menu-result-count')?.textContent).toBe('4 models');
    const openAiFilter = Array.from(document.querySelectorAll<HTMLButtonElement>('.chat-model-menu-provider-filter button'))
      .find((button) => button.textContent?.includes('OpenAI'));
    act(() => openAiFilter?.click());

    expect(document.querySelectorAll('.chat-model-menu-item--model')).toHaveLength(2);
    expect(document.querySelector('.chat-model-menu-provider-head')?.textContent).toContain('OpenAI');
    const bareIdItem = Array.from(document.querySelectorAll('.chat-model-menu-item--model'))
      .find((item) => item.textContent?.includes('gpt-4o-mini'));
    expect(bareIdItem?.querySelector('.chat-model-menu-subtitle')).toBeNull();
    typeInSearch('gpt-4o-mini');
    expect(document.querySelector('.chat-model-menu-result-count')?.textContent).toBe('1 model');
    expect(document.querySelector('.chat-model-menu-close')).toBeNull();
  });

  it('Enter in the search box picks the first match', () => {
    const { onSelectModel } = renderSwitcher();
    openMenu();
    const search = typeInSearch('opus');
    act(() => {
      search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    });
    expect(onSelectModel).toHaveBeenCalledWith('anthropic', 'claude-opus');
    expect(document.querySelector('.chat-model-menu')).toBeNull();
  });

  it('the trigger shows provider and model together', () => {
    renderSwitcher({ selection: MODEL_SELECTION, label: 'Claude Sonnet' });
    expect(host!.querySelector('.chat-model-switcher-provider')?.textContent).toBe('Anthropic');
    expect(host!.querySelector('.chat-model-switcher-model')?.textContent).toBe('Claude Sonnet');
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

  it('surfaces a model switch failure next to the control', async () => {
    renderSwitcher({
      onSelectModel: vi.fn().mockRejectedValue(new Error('Provider is offline')),
    });
    const trigger = host!.querySelector('.chat-model-switcher-btn') as HTMLButtonElement;
    act(() => {
      trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    const modelItem = document.querySelector('.chat-model-menu-item--model') as HTMLElement;
    await act(async () => {
      modelItem.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    const alert = host!.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('Provider is offline');
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

  it('marks the current selection active and leaves focus in the search box', async () => {
    renderSwitcher({ selection: MODEL_SELECTION, label: 'Claude Sonnet' });
    openMenu();
    const active = document.querySelector('.chat-model-menu-item--active') as HTMLElement;
    expect(active.textContent).toContain('Claude Sonnet');

    // Popover's own autoFocus is off here; the switcher focuses the filter
    // input a frame later, once the rect-anchored panel is measured/visible.
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    });
    expect(document.activeElement).toBe(document.querySelector('.chat-model-menu-search input'));
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
