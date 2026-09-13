// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { useCanvasReferenceActions } from './useCanvasReferenceActions';
import { REFERENCE_DRAG_TYPE } from '../../../../../../shared/reference/drag';
import type { CanvasNode } from '../../../../../../types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
it('places an external reference at the transformed drop point without moving the source', () => {
  const host = document.createElement('div'); document.body.append(host);
  const container = document.createElement('div'); document.body.append(container);
  const template: CanvasNode = { id: 'template', title: 'Source', type: 'reference', x: 0, y: 0, width: 200, height: 100,
    data: {}, ref: { kind: 'workspace-node', workspaceId: 'other', nodeId: 'source' } };
  const createReferenceNode = vi.fn(() => template);
  const addNode = vi.fn(() => ({ ...template, id: 'placed' }));
  const updateNode = vi.fn(), select = vi.fn();
  const Probe = () => {
    useCanvasReferenceActions({ canvasId: 'current', containerRef: { current: container }, createReferenceNode,
      addNode, updateNode, setSelectedNodeIds: select, screenToCanvas: (x, y) => ({ x: x / 2, y: y / 2 }) });
    return null;
  };
  const root = createRoot(host);
  try {
    act(() => root.render(<Probe />));
    const entry = { kind: 'node', workspaceId: 'other', nodeId: 'source', typeSnapshot: 'file' };
    const event = new MouseEvent('drop', { clientX: 600, clientY: 400, bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: { getData: (type: string) => type === REFERENCE_DRAG_TYPE ? JSON.stringify(entry) : '' } });
    act(() => container.dispatchEvent(event));
    expect(createReferenceNode).toHaveBeenCalledWith(entry, 300, 200);
    expect(addNode).toHaveBeenCalledWith('reference', 200, 150);
    expect(updateNode).toHaveBeenCalledWith('placed', expect.objectContaining({ ref: template.ref }));
    expect(select).toHaveBeenCalledWith(['placed']);
    expect(event.defaultPrevented).toBe(true);
  } finally { act(() => root.unmount()); host.remove(); container.remove(); }
});
