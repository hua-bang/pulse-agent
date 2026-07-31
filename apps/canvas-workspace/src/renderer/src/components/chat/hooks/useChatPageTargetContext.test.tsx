// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { I18nProvider } from '../../../i18n';
import type { ChatContextSnapshot } from '../ChatTargetContext';
import { useChatPageTargetContext } from './useChatPageTargetContext';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type TargetContext = ReturnType<typeof useChatPageTargetContext>;
let latest: TargetContext | null = null;
let root: Root | null = null;
let host: HTMLDivElement | null = null;

const snapshot: ChatContextSnapshot = {
  label: 'Workspace A',
  requestContext: {
    scope: 'selected_nodes',
    selectedNodes: [{
      id: 'node-1',
      title: 'Release notes',
      type: 'text',
      workspaceId: 'workspace-a',
    }],
  },
};

const Probe = () => {
  latest = useChatPageTargetContext({
    agentScope: { kind: 'workspace', workspaceId: 'workspace-a' },
    allWorkspaces: [{ id: 'workspace-a', name: 'Workspace A' }],
    contextSnapshot: snapshot,
    executionPolicy: 'ask',
  });
  return null;
};

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  latest = null;
});

describe('useChatPageTargetContext', () => {
  it('removes inherited chips from both the bar and the next request', () => {
    host = document.createElement('div');
    root = createRoot(host);
    act(() => root?.render(<I18nProvider><Probe /></I18nProvider>));

    expect(latest?.inheritedContextChips.map(chip => chip.label)).toEqual(['Release notes']);
    expect(latest?.requestContext.selectedNodes).toHaveLength(1);
    act(() => latest?.removeInheritedContext('node:workspace-a:node-1'));

    expect(latest?.inheritedContextChips).toEqual([]);
    expect(latest?.requestContext.selectedNodes).toEqual([]);
    expect(latest?.requestContext.scope).toBe('current_canvas');
    expect(latest?.requestContext.executionMode).toBe('ask');
  });
});
