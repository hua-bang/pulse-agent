// @vitest-environment happy-dom
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../../i18n';
import type { CanvasModelProviderConfig, CanvasModelStatus, CanvasProviderModel } from '../../../../../types';
import { ModelProviderFields } from '../ModelProviderFields';
import { ModelsSection } from '..';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const availableModels: CanvasProviderModel[] = [
  { id: 'gpt-4o', name: 'GPT-4o' },
  { id: 'gpt-4.1', name: 'GPT-4.1' },
  { id: 'claude-opus-4', name: 'Claude Opus 4' },
];

const draft: CanvasModelProviderConfig = {
  id: 'openai',
  name: 'OpenAI',
  provider_type: 'openai',
  base_url: 'https://api.openai.com/v1',
  models: availableModels.slice(0, 2),
};

const status: CanvasModelStatus = {
  path: '/tmp/model-config.json',
  currentProvider: 'openai',
  currentModel: 'gpt-4o',
  providerType: 'openai',
  resolvedModel: 'gpt-4o',
  resolvedBaseURL: 'https://api.openai.com/v1',
  resolvedApiKeyEnv: 'OPENAI_API_KEY',
  apiKeyPresent: true,
  options: [],
  providers: [{
    id: 'openai',
    name: 'OpenAI',
    provider_type: 'openai',
    base_url: 'https://api.openai.com/v1',
    api_key_env: 'OPENAI_API_KEY',
    apiKeyPresent: true,
    models: availableModels.slice(0, 1),
  }],
};

describe('ModelProviderFields model picker', () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  const mount = (content: ReactNode) => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root?.render(<I18nProvider>{content}</I18nProvider>));
  };

  const renderProviderFields = (toggleModel = vi.fn()) => {
    mount(
      <ModelProviderFields
        activeProviderId="openai"
        addManualModel={vi.fn()}
        availableModels={availableModels}
        draft={draft}
        fetching={false}
        fetchModels={vi.fn()}
        manualModel=""
        setDraftField={vi.fn()}
        setManualModel={vi.fn()}
        toggleModel={toggleModel}
      />,
    );
  };

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('filters a checkbox list without rendering destructive x controls', () => {
    const onToggleModel = vi.fn();
    renderProviderFields(onToggleModel);

    expect(host.textContent).toContain('2 selected / 3');
    expect(host.querySelectorAll<HTMLButtonElement>('.chat-model-model-row[role="checkbox"]')).toHaveLength(3);
    expect(host.querySelector('.chat-model-chip')).toBeNull();

    const search = host.querySelector<HTMLInputElement>('[aria-label="Search models"]');
    act(() => {
      if (!search) return;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(search, 'opus');
      search.dispatchEvent(new InputEvent('input', { bubbles: true }));
    });
    expect(host.querySelectorAll('.chat-model-model-row')).toHaveLength(1);
    expect(host.textContent).toContain('Claude Opus 4');

    const checkbox = host.querySelector<HTMLButtonElement>('.chat-model-model-row[role="checkbox"]');
    act(() => checkbox?.click());
    expect(onToggleModel).toHaveBeenCalledWith(availableModels[2], true);
  });

  it('can narrow the catalog to selected models', () => {
    renderProviderFields();

    const selectedFilter = Array.from(host.querySelectorAll<HTMLButtonElement>('.chat-model-model-filters button'))
      .find((button) => button.textContent?.includes('Selected'));
    act(() => selectedFilter?.click());

    expect(host.querySelectorAll('.chat-model-model-row')).toHaveLength(2);
    expect(host.textContent).not.toContain('Claude Opus 4');
    expect(selectedFilter?.getAttribute('aria-checked')).toBe('true');
  });

  it('keeps fetched catalog entries unselected until the user chooses them', async () => {
    const onFetchModels = vi.fn().mockResolvedValue(availableModels);
    const onSaveProvider = vi.fn().mockResolvedValue(status);

    mount(
      <ModelsSection
        status={status}
        onClose={vi.fn()}
        onSaveProvider={onSaveProvider}
        onRemoveProvider={vi.fn()}
        onFetchModels={onFetchModels}
      />,
    );

    const fetchButton = Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent?.trim() === 'Fetch');
    await act(async () => {
      fetchButton?.click();
      await Promise.resolve();
    });

    expect(host.textContent).toContain('1 selected / 3');
    expect(host.querySelectorAll('.chat-model-model-row')).toHaveLength(3);

    const saveButton = Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent?.trim() === 'Test & Save');
    await act(async () => {
      saveButton?.click();
      await Promise.resolve();
    });

    expect(onSaveProvider).toHaveBeenCalledTimes(1);
    expect(onSaveProvider.mock.calls[0]?.[0].models).toEqual(availableModels.slice(0, 1));
  });

  it('pauses first-time save after fetching so the user can select a model', async () => {
    const onFetchModels = vi.fn().mockResolvedValue(availableModels);
    const onSaveProvider = vi.fn().mockResolvedValue(status);
    mount(
      <ModelsSection
        onClose={vi.fn()}
        onSaveProvider={onSaveProvider}
        onRemoveProvider={vi.fn()}
        onFetchModels={onFetchModels}
      />,
    );

    const fill = (selector: string, value: string) => {
      const input = host.querySelector<HTMLInputElement>(selector);
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
        input?.dispatchEvent(new InputEvent('input', { bubbles: true }));
      });
    };
    fill('[placeholder="DeepSeek / OpenRouter / Local"]', 'Custom Provider');
    fill('[placeholder="https://api.deepseek.com/v1"]', 'https://example.com/v1');
    fill('[placeholder="Enter API Key"]', 'sk-test');

    const saveButton = Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent?.trim() === 'Test & Save');
    await act(async () => {
      saveButton?.click();
      await Promise.resolve();
    });

    expect(onFetchModels).toHaveBeenCalledTimes(1);
    expect(onSaveProvider).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Select at least one model, then save again.');
    expect(host.querySelectorAll('.chat-model-model-row')).toHaveLength(3);

    const firstModel = host.querySelector<HTMLButtonElement>('.chat-model-model-row');
    act(() => firstModel?.click());
    await act(async () => {
      saveButton?.click();
      await Promise.resolve();
    });
    expect(onSaveProvider.mock.calls[0]?.[0].models).toEqual(availableModels.slice(0, 1));
  });
});
