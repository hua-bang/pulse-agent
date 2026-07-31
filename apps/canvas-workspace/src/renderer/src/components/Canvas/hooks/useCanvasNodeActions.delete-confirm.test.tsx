// @vitest-environment happy-dom
import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../i18n';
import { useCanvasNodeActions } from './useCanvasNodeActions';
import type { CanvasNode } from '../../../types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let mount: HTMLDivElement | null = null;

const node = (id: string, type: CanvasNode['type']): CanvasNode => ({
  id,
  type,
  title: `${type} ${id}`,
  x: 0,
  y: 0,
  width: 200,
  height: 120,
  data: {},
} as CanvasNode);

let api: ReturnType<typeof useCanvasNodeActions>;

interface ConfirmArgs {
  intent?: 'danger' | 'default';
  title: string;
  description?: string;
  confirmLabel?: string;
}

const Harness = ({
  nodes,
  removeNodes,
  confirm,
}: {
  nodes: CanvasNode[];
  removeNodes: (ids: string[]) => void;
  confirm: (args: ConfirmArgs) => Promise<boolean>;
}) => {
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  api = useCanvasNodeActions({
    nodesRef,
    edges: [],
    selectedNodeIds: [],
    setSelectedNodeIds: () => undefined,
    selectedEdgeId: null,
    setSelectedEdgeId: () => undefined,
    editingEdgeLabelId: null,
    setEditingEdgeLabelId: () => undefined,
    canvasId: 'ws-1',
    removeNodes,
    syncDeletedNodes: () => undefined,
    removeEdge: () => undefined,
    groupNodes: () => null,
    ungroupNodes: () => [],
    wrapNodesInFrame: () => null,
    notify: () => undefined,
    confirm,
  });
  return null;
};

const render = (nodes: CanvasNode[], confirmResult: boolean) => {
  const removeNodes = vi.fn();
  const confirm = vi.fn(async (_args: ConfirmArgs) => confirmResult);
  act(() => root?.render(
    <I18nProvider>
      <Harness nodes={nodes} removeNodes={removeNodes} confirm={confirm} />
    </I18nProvider>,
  ));
  return { removeNodes, confirm };
};

beforeEach(() => {
  mount = document.createElement('div');
  document.body.appendChild(mount);
  root = createRoot(mount);
});

afterEach(() => {
  act(() => root?.unmount());
  mount?.remove();
  root = null;
  mount = null;
});

describe('requestRemoveNodes — coding agent confirmation', () => {
  it('asks before deleting a lone coding agent, and honours a decline', async () => {
    const agent = node('a1', 'agent');
    const { removeNodes, confirm } = render([agent], false);

    await act(async () => { await api.requestRemoveNodes([agent.id]); });

    expect(confirm).toHaveBeenCalledOnce();
    // The dialog must name the agent, or a multi-canvas user cannot tell
    // which session they are about to end.
    expect(confirm.mock.calls[0][0]).toMatchObject({
      intent: 'danger',
      title: expect.stringContaining('agent a1'),
    });
    expect(removeNodes).not.toHaveBeenCalled();
  });

  it('deletes the agent once the user accepts', async () => {
    const agent = node('a1', 'agent');
    const { removeNodes, confirm } = render([agent], true);

    await act(async () => { await api.requestRemoveNodes([agent.id]); });

    expect(confirm).toHaveBeenCalledOnce();
    expect(removeNodes).toHaveBeenCalledWith([agent.id]);
  });

  it('still deletes a lone ordinary node without asking', async () => {
    const text = node('t1', 'text');
    const { removeNodes, confirm } = render([text], true);

    await act(async () => { await api.requestRemoveNodes([text.id]); });

    expect(confirm).not.toHaveBeenCalled();
    expect(removeNodes).toHaveBeenCalledWith([text.id]);
  });

  it('asks once for a batch that contains an agent, and aborts the whole batch', async () => {
    const text = node('t1', 'text');
    const agent = node('a1', 'agent');
    const { removeNodes, confirm } = render([text, agent], false);

    await act(async () => { await api.requestRemoveNodes([text.id, agent.id]); });

    expect(confirm).toHaveBeenCalledOnce();
    expect(removeNodes).not.toHaveBeenCalled();
  });
});
