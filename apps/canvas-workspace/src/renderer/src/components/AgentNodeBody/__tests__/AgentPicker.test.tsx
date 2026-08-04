// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentPicker } from '../AgentPicker';
import { AGENT_REGISTRY } from '../../../config/agentRegistry';
import { I18nProvider } from '../../../i18n';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let mount: HTMLDivElement | null = null;

const noop = () => {};

const renderPicker = async (selectedAgent: string) => {
  mount = document.createElement('div');
  document.body.appendChild(mount);
  root = createRoot(mount);
  await act(async () => root?.render(
    <I18nProvider>
      <AgentPicker
        selectedAgent={selectedAgent}
        cwdInput=""
        promptInput=""
        dangerousMode={false}
        recentCwds={[]}
        onAgentChange={noop}
        onCwdChange={noop}
        onPromptChange={noop}
        onDangerousModeChange={noop}
        onPickFolder={noop}
        onLaunch={noop}
      />
    </I18nProvider>,
  ));
  // Let the per-agent `checkCommand` probes settle so no tab stays "checking".
  await act(async () => { await Promise.resolve(); });
};

beforeEach(() => {
  // Every registered CLI reports as installed, so no tab renders disabled.
  (window as unknown as { canvasWorkspace: unknown }).canvasWorkspace = {
    pty: { checkCommand: vi.fn().mockResolvedValue({ ok: true, available: true }) },
    shell: { openExternal: vi.fn() },
  };
});

afterEach(() => {
  act(() => root?.unmount());
  mount?.remove();
  root = null;
  mount = null;
  delete (window as unknown as { canvasWorkspace?: unknown }).canvasWorkspace;
});

describe('AgentPicker', () => {
  it('offers one tab per registered agent, including Pi, on a single row', async () => {
    await renderPicker('claude-code');

    const tabs = [...mount!.querySelectorAll('[role="tab"]')];
    expect(tabs).toHaveLength(AGENT_REGISTRY.length);
    expect(tabs.map((tab) => tab.textContent)).toContain('Pi');

    // The grid track count follows the registry, so a third agent widens the
    // row instead of wrapping onto a half-empty second line.
    const tablist = mount!.querySelector<HTMLElement>('.agent-tabs');
    expect(tablist?.style.getPropertyValue('--agent-tab-count'))
      .toBe(String(AGENT_REGISTRY.length));
  });

  it('marks the selected agent and hides the approval toggle for Pi', async () => {
    await renderPicker('pi');

    const selected = mount!.querySelector('[role="tab"][aria-selected="true"]');
    expect(selected?.textContent).toBe('Pi');
    // Pi executes tools without asking, so there is no approval flag to skip.
    expect(mount!.querySelector('.agent-dangerous-toggle')).toBeNull();
  });

  it('keeps the approval toggle for agents that do have an approval flag', async () => {
    await renderPicker('claude-code');
    expect(mount!.querySelector('.agent-dangerous-toggle')).toBeTruthy();
  });
});
