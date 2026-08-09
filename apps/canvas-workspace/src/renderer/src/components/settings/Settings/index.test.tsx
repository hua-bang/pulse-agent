// @vitest-environment happy-dom
import { act, type PropsWithChildren, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../i18n';
import { Settings } from './index';

vi.mock('../../ui', () => ({
  Drawer: ({ open, children }: PropsWithChildren<{ open: boolean }>) => (
    open ? <div>{children}</div> : null
  ),
  SegmentedControl: ({
    options,
    value,
    onChange,
    ariaLabel,
  }: {
    options: Array<{ id: string; label: ReactNode }>;
    value: string;
    onChange: (id: string) => void;
    ariaLabel?: string;
  }) => (
    <div role="tablist" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="tab"
          aria-selected={option.id === value}
          onClick={() => onChange(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  ),
}));

vi.mock('../../chat/ModelSettings', () => ({
  ModelsSection: () => <div>Models content</div>,
  useCanvasModels: () => ({
    status: undefined,
    error: null,
    upsertProvider: vi.fn(),
    removeProvider: vi.fn(),
    fetchModels: vi.fn(),
  }),
}));

vi.mock('../../chat/PromptSettings', () => ({
  ReplyStyleSection: () => <div>Reply style content</div>,
  usePromptProfile: () => ({
    profile: undefined,
    error: null,
    save: vi.fn(),
    reset: vi.fn(),
  }),
}));

vi.mock('../../chat/RolesSettings', () => ({ RolesSection: () => <div>Roles content</div> }));
vi.mock('./AgentSection', () => ({ AgentSection: () => <div>Agent content</div> }));
vi.mock('./BrowserSection', () => ({ BrowserSection: () => <div>Browser content</div> }));
vi.mock('./BuiltInToolsSection', () => ({ BuiltInToolsSection: () => <div>Tools content</div> }));
vi.mock('./ExperimentalSection', () => ({ ExperimentalSection: () => <div>Experimental content</div> }));
vi.mock('./LanguageSection', () => ({ LanguageSection: () => <div>Language content</div> }));
vi.mock('./UpdateSection', () => ({ UpdateSection: () => <div>Updates content</div> }));
vi.mock('../settings-config/McpManager', () => ({ McpManager: () => <div>MCP content</div> }));
vi.mock('../settings-config/PluginsManager', () => ({ PluginsManager: () => <div>Plugins content</div> }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

beforeEach(() => {
  localStorage.clear();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe('Settings navigation', () => {
  it('clusters settings by user task and keeps the rail concise', () => {
    act(() => {
      root?.render(
        <I18nProvider>
          <Settings open initialSection="models" onClose={vi.fn()} />
        </I18nProvider>,
      );
    });

    const groupTitles = Array.from(host?.querySelectorAll('.settings-rail-group-title') ?? [])
      .map((element) => element.textContent?.trim());
    expect(groupTitles).toEqual(['Model & Chat', 'Agents & Extensions', 'App']);

    const itemLabels = Array.from(host?.querySelectorAll('.settings-rail-label') ?? [])
      .map((element) => element.textContent?.trim());
    expect(itemLabels).toEqual([
      'Models',
      'Chat',
      'Agent',
      'Tools & Integrations',
      'General',
      'Experimental',
    ]);
    expect(host?.querySelector('.settings-rail-desc')).toBeNull();
  });

  it('keeps direct navigation to a merged settings tab', () => {
    act(() => {
      root?.render(
        <I18nProvider>
          <Settings open initialSection="mcp" onClose={vi.fn()} />
        </I18nProvider>,
      );
    });

    const activeItem = host?.querySelector('.settings-rail-item[aria-current="page"]');
    expect(activeItem?.textContent?.trim()).toBe('Tools & Integrations');
    expect(host?.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('MCP Servers');
    expect(host?.textContent).toContain('MCP content');
  });

  it('switches the merged Chat page between reply style and roles', () => {
    act(() => {
      root?.render(
        <I18nProvider>
          <Settings open initialSection="reply-style" onClose={vi.fn()} />
        </I18nProvider>,
      );
    });

    expect(host?.textContent).toContain('Reply style content');
    const rolesTab = Array.from(host?.querySelectorAll('[role="tab"]') ?? [])
      .find((element) => element.textContent === 'Chat Roles') as HTMLButtonElement | undefined;
    act(() => rolesTab?.click());
    expect(host?.textContent).toContain('Roles content');
    expect(host?.textContent).not.toContain('Reply style content');
  });

  it('shows lightweight app preferences together on General', () => {
    act(() => {
      root?.render(
        <I18nProvider>
          <Settings open initialSection="browser" onClose={vi.fn()} />
        </I18nProvider>,
      );
    });

    expect(host?.querySelector('.settings-rail-item[aria-current="page"]')?.textContent?.trim()).toBe('General');
    expect(host?.textContent).toContain('Browser content');
    expect(host?.textContent).toContain('Language content');
    expect(host?.textContent).toContain('Updates content');
  });
});
