// @vitest-environment happy-dom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../i18n';
import { AppShellProvider } from '../../AppShellProvider';

vi.mock('../NodeDetailPanel', () => ({
  NodeDetailPanel: () => <div data-testid="panel" />,
}));

vi.mock('../useWorkspaceNodes', () => ({
  useWorkspaceNode: () => ({ node: null, loading: false, error: null, missing: false, setNode: () => undefined, reload: () => undefined }),
  useKnowledgeTags: () => ({ tags: [], reload: () => undefined }),
  useWorkspaceNodeList: () => ({ nodes: [], tags: [], reload: () => undefined }),
}));

import { NodeDetailPage } from '../NodeDetailPage';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

const render = (node: ReactNode) => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root?.render(<I18nProvider><AppShellProvider>{node}</AppShellProvider></I18nProvider>);
  });
  return host;
};

const pressEscape = (target: EventTarget) => {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
};

describe('NodeDetailPage Escape', () => {
  it('returns to the surface the node was opened from', () => {
    const onBack = vi.fn();
    render(<NodeDetailPage workspaceId="workspace-1" nodeId="node-1" onBack={onBack} />);

    pressEscape(document.body);

    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('leaves Escape to the field the user is editing', () => {
    const onBack = vi.fn();
    const view = render(<NodeDetailPage workspaceId="workspace-1" nodeId="node-1" onBack={onBack} />);

    const input = document.createElement('input');
    view.appendChild(input);
    pressEscape(input);

    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    view.appendChild(editable);
    pressEscape(editable);

    expect(onBack).not.toHaveBeenCalled();
  });

  it('stops listening once the route unmounts', () => {
    const onBack = vi.fn();
    render(<NodeDetailPage workspaceId="workspace-1" nodeId="node-1" onBack={onBack} />);
    act(() => root?.unmount());
    root = null;

    pressEscape(document.body);

    expect(onBack).not.toHaveBeenCalled();
  });
});
