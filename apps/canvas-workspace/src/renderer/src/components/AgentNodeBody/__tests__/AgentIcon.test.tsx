// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentIcon } from '../AgentIcon';
import { AGENT_REGISTRY } from '../../../config/agentRegistry';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let mount: HTMLDivElement | null = null;

const renderIcon = (id: string): string => {
  mount = document.createElement('div');
  document.body.appendChild(mount);
  root = createRoot(mount);
  act(() => root?.render(<AgentIcon id={id} size={16} />));
  return mount.innerHTML;
};

afterEach(() => {
  act(() => root?.unmount());
  mount?.remove();
  root = null;
  mount = null;
});

describe('AgentIcon', () => {
  it('gives every registered agent its own mark, distinct from the fallback', () => {
    const fallback = renderIcon('__not-a-registered-agent__');
    const marks = new Map<string, string>();

    for (const agent of AGENT_REGISTRY) {
      act(() => root?.unmount());
      mount?.remove();
      const markup = renderIcon(agent.id);
      expect(markup, `${agent.id} falls back to the generic mark`).not.toBe(fallback);
      marks.set(agent.id, markup);
    }

    expect(new Set(marks.values()).size).toBe(AGENT_REGISTRY.length);
  });

  it('renders the Pi mark when the pi agent is selected', () => {
    expect(renderIcon('pi')).toContain('#6e56cf');
  });
});
