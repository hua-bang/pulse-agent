// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CanvasNode } from '../../../types';
import { shouldHandleCanvasFindShortcut, useCanvasKeyboard } from './useCanvasKeyboard';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

const modF = (overrides: Partial<Parameters<typeof shouldHandleCanvasFindShortcut>[0]> = {}) => ({
  ctrlKey: false,
  key: 'f',
  metaKey: true,
  shiftKey: false,
  ...overrides,
});

const elementInsideSelector = (matchingSelector: string) => ({
  tagName: 'DIV',
  closest: (selector: string) => selector.split(',').map((item) => item.trim()).includes(matchingSelector)
    ? { tagName: 'DIV' }
    : null,
});

const elementOutsideExcludedSurfaces = (tagName = 'DIV') => ({
  tagName,
  closest: () => null,
});

describe('shouldHandleCanvasFindShortcut', () => {
  it.each([
    ['note card', '.note-card'],
    ['iframe node chrome', '.iframe-body'],
    ['link drawer header', '.link-drawer__header'],
    ['link drawer page surface', '.link-drawer__webview-surface'],
    ['link drawer find bar', '.link-drawer__find'],
  ])('lets %s own Cmd/Ctrl+F', (_label, selector) => {
    expect(shouldHandleCanvasFindShortcut(modF(), elementInsideSelector(selector))).toBe(false);
  });

  it('handles Cmd/Ctrl+F outside excluded surfaces, including regular editable controls', () => {
    expect(shouldHandleCanvasFindShortcut(modF(), elementOutsideExcludedSurfaces())).toBe(true);
    expect(shouldHandleCanvasFindShortcut(modF({ ctrlKey: true, metaKey: false }), elementOutsideExcludedSurfaces('INPUT')))
      .toBe(true);
  });

  it('ignores unrelated or already-handled key events', () => {
    expect(shouldHandleCanvasFindShortcut(modF({ defaultPrevented: true }), elementOutsideExcludedSurfaces()))
      .toBe(false);
    expect(shouldHandleCanvasFindShortcut(modF({ key: 'k' }), elementOutsideExcludedSurfaces())).toBe(false);
    expect(shouldHandleCanvasFindShortcut(modF({ shiftKey: true }), elementOutsideExcludedSurfaces())).toBe(false);
  });
});

describe('useCanvasKeyboard', () => {
  const node = (id: string): CanvasNode => ({
    id,
    type: 'text',
    title: id,
    x: 0,
    y: 0,
    width: 240,
    height: 120,
    data: {},
  });

  const mountKeyboard = (
    overrides: Partial<Parameters<typeof useCanvasKeyboard>[0]> = {},
  ) => {
    const options: Parameters<typeof useCanvasKeyboard>[0] = {
      canvasId: 'canvas-1',
      undo: vi.fn(),
      redo: vi.fn(),
      nodes: [],
      selectedNodeIds: [],
      setSelectedNodeIds: vi.fn(),
      selectedEdgeId: null,
      setSelectedEdgeId: vi.fn(),
      removeEdge: vi.fn(),
      duplicateNode: vi.fn(),
      setClipboard: vi.fn(),
      groupSelectedNodes: vi.fn(),
      ungroupSelectedNodes: vi.fn(),
      removeNodes: vi.fn(),
      moveNodes: vi.fn(),
      commitHistory: vi.fn(),
      searchOpen: false,
      setSearchOpen: vi.fn(),
      findOpen: false,
      toggleFindBar: vi.fn(),
      closeFindBar: vi.fn(),
      findNext: vi.fn(),
      findPrev: vi.fn(),
      findHasMatches: false,
      contextMenu: null,
      setContextMenu: vi.fn(),
      setHighlightedId: vi.fn(),
      handleFocusNode: vi.fn(),
      activeTool: 'select',
      setActiveTool: vi.fn(),
      zoomBy: vi.fn(),
      resetZoom: vi.fn(),
      fitNodes: vi.fn(),
      renameNode: vi.fn(),
      ...overrides,
    };
    const Harness = () => {
      useCanvasKeyboard(options);
      return null;
    };

    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    act(() => root?.render(createElement(Harness)));
  };

  const press = (init: KeyboardEventInit & { key: string }): KeyboardEvent => {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    act(() => { window.dispatchEvent(event); });
    return event;
  };

  it.each(['connect', 'shape-rect'])(
    'returns an idle %s tool to select when Escape is pressed',
    (activeTool) => {
      const setActiveTool = vi.fn();
      mountKeyboard({ activeTool, setActiveTool });

      press({ key: 'Escape' });

      expect(setActiveTool).toHaveBeenCalledWith('select');
    },
  );

  it('clears an edge selection when Cmd/Ctrl+A selects every node', () => {
    const setSelectedNodeIds = vi.fn();
    const setSelectedEdgeId = vi.fn();
    mountKeyboard({
      nodes: [node('node-1'), node('node-2')],
      selectedEdgeId: 'edge-1',
      setSelectedNodeIds,
      setSelectedEdgeId,
    });

    press({ key: 'a', metaKey: true });

    expect(setSelectedNodeIds).toHaveBeenCalledWith(['node-1', 'node-2']);
    expect(setSelectedEdgeId).toHaveBeenCalledWith(null);
  });

  it('clears an edge selection when Ctrl+Tab focuses another node', () => {
    const setSelectedNodeIds = vi.fn();
    const setSelectedEdgeId = vi.fn();
    mountKeyboard({
      nodes: [node('node-1'), node('node-2')],
      selectedNodeIds: ['node-1'],
      selectedEdgeId: 'edge-1',
      setSelectedNodeIds,
      setSelectedEdgeId,
    });

    press({ key: 'Tab', ctrlKey: true });

    expect(setSelectedNodeIds).toHaveBeenCalledWith(['node-2']);
    expect(setSelectedEdgeId).toHaveBeenCalledWith(null);
  });

  // Regression: the old matcher tested `isMod && e.key === 'a'` without
  // looking at Shift, so the combo the UI advertised as "toggle side chat"
  // silently ran select-all instead — and nothing toggled the chat panel.
  it('routes Cmd/Ctrl+Shift+A to the chat panel and never to select-all', () => {
    const setSelectedNodeIds = vi.fn();
    const onToggleChatPanel = vi.fn();
    mountKeyboard({
      nodes: [node('node-1')],
      setSelectedNodeIds,
      onToggleChatPanel,
    });

    press({ key: 'a', metaKey: true, shiftKey: true });

    expect(onToggleChatPanel).toHaveBeenCalledTimes(1);
    expect(setSelectedNodeIds).not.toHaveBeenCalled();
  });

  // Regression: every keydown pushed a history entry, so HOLDING an arrow
  // key filled the undo stack with one entry per OS repeat tick.
  it('ignores auto-repeat so a held arrow key is a single undo step', () => {
    const moveNodes = vi.fn();
    const commitHistory = vi.fn();
    mountKeyboard({
      nodes: [node('node-1')],
      selectedNodeIds: ['node-1'],
      moveNodes,
      commitHistory,
    });

    press({ key: 'ArrowRight' });
    press({ key: 'ArrowRight', repeat: true });
    press({ key: 'ArrowRight', repeat: true });

    expect(moveNodes).toHaveBeenCalledTimes(1);
    expect(commitHistory).toHaveBeenCalledTimes(1);
    expect(moveNodes).toHaveBeenCalledWith([{ id: 'node-1', x: 1, y: 0 }]);
  });

  it('nudges by 10 with Shift held', () => {
    const moveNodes = vi.fn();
    mountKeyboard({
      nodes: [node('node-1')],
      selectedNodeIds: ['node-1'],
      moveNodes,
    });

    press({ key: 'ArrowDown', shiftKey: true });

    expect(moveNodes).toHaveBeenCalledWith([{ id: 'node-1', x: 0, y: 10 }]);
  });

  // Regression: Escape used to be consumed unconditionally, so one press
  // closed the find bar AND whatever the app shell / right dock had open.
  describe('Escape', () => {
    it('consumes the event when it actually closed something', () => {
      const closeFindBar = vi.fn();
      mountKeyboard({ findOpen: true, closeFindBar });

      const event = press({ key: 'Escape' });

      expect(closeFindBar).toHaveBeenCalledTimes(1);
      expect(event.defaultPrevented).toBe(true);
    });

    it('leaves the event for other layers when nothing was open or selected', () => {
      mountKeyboard({});

      const event = press({ key: 'Escape' });

      expect(event.defaultPrevented).toBe(false);
    });
  });

  it('skips every shortcut while an IME candidate window is open', () => {
    const setSearchOpen = vi.fn();
    mountKeyboard({ setSearchOpen });

    press({ key: 'k', metaKey: true, isComposing: true });

    expect(setSearchOpen).not.toHaveBeenCalled();
  });

  it('mirrors a canvas copy into the system clipboard so paste can compare', () => {
    const setClipboard = vi.fn();
    mountKeyboard({
      nodes: [node('node-1')],
      selectedNodeIds: ['node-1'],
      setClipboard,
    });

    press({ key: 'c', metaKey: true });

    expect(setClipboard).toHaveBeenCalledWith(expect.objectContaining({
      sourceWorkspaceId: 'canvas-1',
      systemText: 'node-1',
    }));
  });

  describe('view shortcuts', () => {
    it('zooms, resets, and fits from the keyboard', () => {
      const zoomBy = vi.fn();
      const resetZoom = vi.fn();
      const fitNodes = vi.fn();
      const nodes = [node('node-1'), node('node-2')];
      mountKeyboard({ nodes, selectedNodeIds: ['node-2'], zoomBy, resetZoom, fitNodes });

      press({ key: '=', metaKey: true });
      press({ key: '-', metaKey: true });
      press({ key: '0', metaKey: true });
      press({ key: '1', shiftKey: true });
      press({ key: '2', shiftKey: true });

      expect(zoomBy).toHaveBeenNthCalledWith(1, expect.any(Number));
      expect(zoomBy.mock.calls[0][0]).toBeGreaterThan(1);
      expect(zoomBy.mock.calls[1][0]).toBeLessThan(1);
      expect(resetZoom).toHaveBeenCalledTimes(1);
      expect(fitNodes).toHaveBeenNthCalledWith(1, nodes);
      expect(fitNodes).toHaveBeenNthCalledWith(2, [nodes[1]]);
    });

    it.each([
      ['v', 'select'],
      ['h', 'hand'],
      ['c', 'connect'],
    ])('binds %s to the %s tool', (key, tool) => {
      const setActiveTool = vi.fn();
      mountKeyboard({ setActiveTool });

      press({ key });

      expect(setActiveTool).toHaveBeenCalledWith(tool);
    });

    it('keeps the hidden shape tool unreachable from its former shortcut', () => {
      const setActiveTool = vi.fn();
      mountKeyboard({ setActiveTool });

      press({ key: 'r' });

      expect(setActiveTool).not.toHaveBeenCalled();
    });
  });

  it('renames the single selected node on Enter and F2', () => {
    const renameNode = vi.fn();
    mountKeyboard({ nodes: [node('node-1')], selectedNodeIds: ['node-1'], renameNode });

    press({ key: 'Enter' });
    press({ key: 'F2' });

    expect(renameNode).toHaveBeenCalledTimes(2);
    expect(renameNode).toHaveBeenCalledWith('node-1');
  });

  it('does not rename when the selection is not exactly one node', () => {
    const renameNode = vi.fn();
    mountKeyboard({
      nodes: [node('node-1'), node('node-2')],
      selectedNodeIds: ['node-1', 'node-2'],
      renameNode,
    });

    press({ key: 'Enter' });

    expect(renameNode).not.toHaveBeenCalled();
  });

  it('stays inert while the canvas keyboard is locked', () => {
    const setSearchOpen = vi.fn();
    mountKeyboard({ keyboardLocked: true, setSearchOpen });

    press({ key: 'k', metaKey: true });

    expect(setSearchOpen).not.toHaveBeenCalled();
  });
});
