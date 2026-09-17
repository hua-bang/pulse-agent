// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSidebarLayers } from '../useSidebarLayers';
import { createDefaultNode } from '../../../../utils/nodeFactory';
import { I18nProvider } from '../../../../i18n';
import { AppShellProvider } from '../../AppShellProvider';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let current: ReturnType<typeof useSidebarLayers>;
let options: Parameters<typeof useSidebarLayers>[0];
const rename = vi.fn();
const remove = vi.fn();
const Harness = () => {
  current = useSidebarLayers(options);
  return null;
};
const render = () => act(() => root.render(
  <I18nProvider><AppShellProvider><Harness /></AppShellProvider></I18nProvider>,
));
beforeEach(() => {
  vi.clearAllMocks();
  root = createRoot(document.createElement('div'));
  options = {
    activeId: 'workspace', selectedNodeIds: [], onNodeRename: rename, onNodeDelete: remove,
    activeNodes: [
      { ...createDefaultNode('frame', 0, 0), id: 'frame', width: 500, height: 500 },
      { ...createDefaultNode('text', 100, 100), id: 'text', width: 100, height: 100, title: 'Note' },
    ],
  };
  render();
});
afterEach(() => act(() => root.unmount()));

describe('Sidebar layer state', () => {
  it('reveals ancestors on selection changes and keeps collapse-all reversible', () => {
    expect(current.frameIds).toEqual(['frame']);
    act(() => current.toggleAllLayers());
    expect(current.collapsedLayers.has('frame')).toBe(true);
    expect(current.anyFrameExpanded).toBe(false);
    options = { ...options, selectedNodeIds: ['text'] };
    render();
    expect(current.collapsedLayers.has('frame')).toBe(false);
    expect(current.primarySelectedNodeId).toBe('text');
    act(() => current.toggleAllLayers());
    expect(current.anyFrameExpanded).toBe(false);
    act(() => current.toggleAllLayers());
    expect(current.anyFrameExpanded).toBe(true);
  });

  it('trims node titles, ignores unchanged names, and refuses actions for missing nodes', () => {
    act(() => current.startLayerRename('text'));
    act(() => current.commitLayerRename());
    expect(rename).not.toHaveBeenCalled();
    act(() => current.startLayerRename('text'));
    act(() => current.setRenameLayerValue('  Renamed  '));
    act(() => current.commitLayerRename());
    expect(rename).toHaveBeenCalledWith('text', 'Renamed');
    expect(current.renamingLayerId).toBeNull();
    act(() => current.handleLayerDelete('missing'));
    expect(remove).not.toHaveBeenCalled();
    act(() => current.handleLayerDelete('text'));
    expect(remove).toHaveBeenCalledWith('text');
  });
});
