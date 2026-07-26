// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CanvasNode } from '../types';
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

const elementInNote = () => ({
  tagName: 'DIV',
  closest: (selector: string) => (selector === '.note-card' ? { tagName: 'DIV' } : null),
});

const elementOutsideNote = (tagName = 'DIV') => ({
  tagName,
  closest: () => null,
});

describe('shouldHandleCanvasFindShortcut', () => {
  it('lets note-local find own Cmd/Ctrl+F while focus is inside a note card', () => {
    expect(shouldHandleCanvasFindShortcut(modF(), elementInNote())).toBe(false);
  });

  it('handles Cmd/Ctrl+F outside note cards, including regular editable controls', () => {
    expect(shouldHandleCanvasFindShortcut(modF(), elementOutsideNote())).toBe(true);
    expect(shouldHandleCanvasFindShortcut(modF({ ctrlKey: true, metaKey: false }), elementOutsideNote('INPUT')))
      .toBe(true);
  });

  it('ignores unrelated or already-handled key events', () => {
    expect(shouldHandleCanvasFindShortcut(modF({ defaultPrevented: true }), elementOutsideNote()))
      .toBe(false);
    expect(shouldHandleCanvasFindShortcut(modF({ key: 'k' }), elementOutsideNote())).toBe(false);
    expect(shouldHandleCanvasFindShortcut(modF({ shiftKey: true }), elementOutsideNote())).toBe(false);
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
      clipboard: null,
      setClipboard: vi.fn(),
      pasteNodes: vi.fn(() => []),
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

  it.each(['connect', 'shape-rect'])(
    'returns an idle %s tool to select when Escape is pressed',
    (activeTool) => {
      const setActiveTool = vi.fn();
      mountKeyboard({ activeTool, setActiveTool });

      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Escape',
          bubbles: true,
          cancelable: true,
        }));
      });

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

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'a',
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }));
    });

    expect(setSelectedNodeIds).toHaveBeenCalledWith(['node-1', 'node-2']);
    expect(setSelectedEdgeId).toHaveBeenCalledWith(null);
  });

  it('clears an edge selection when Cmd/Ctrl+Tab focuses another node', () => {
    const setSelectedNodeIds = vi.fn();
    const setSelectedEdgeId = vi.fn();
    mountKeyboard({
      nodes: [node('node-1'), node('node-2')],
      selectedNodeIds: ['node-1'],
      selectedEdgeId: 'edge-1',
      setSelectedNodeIds,
      setSelectedEdgeId,
    });

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Tab',
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }));
    });

    expect(setSelectedNodeIds).toHaveBeenCalledWith(['node-2']);
    expect(setSelectedEdgeId).toHaveBeenCalledWith(null);
  });
});
