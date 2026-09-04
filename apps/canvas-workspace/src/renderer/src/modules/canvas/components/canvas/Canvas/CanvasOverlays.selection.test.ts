// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../../i18n';
import { RightDockProvider } from '../../../../dock/internal/RightDock';
import { CanvasOverlays } from './CanvasOverlays';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type CanvasOverlaysProps = ComponentProps<typeof CanvasOverlays>;

const sampleNode = {
  id: 'node-1',
  type: 'text',
  title: 'Selected note',
  x: 0,
  y: 0,
  width: 240,
  height: 120,
  data: { content: 'hello' },
  updatedAt: 1,
} as CanvasOverlaysProps['nodes'][number];

const baseProps = (): CanvasOverlaysProps => ({
  nodes: [sampleNode],
  contextMenu: null,
  searchOpen: false,
  activeTool: 'select',
  scale: 1,
  onCreateNode: vi.fn(),
  onCloseContextMenu: vi.fn(),
  onOpenShortcuts: vi.fn(),
  onToolChange: vi.fn(),
  onAddNode: vi.fn(),
  onResetTransform: vi.fn(),
  paletteCommands: [],
  onSearchSelect: vi.fn(),
  onCloseSearch: vi.fn(),
  findSearch: { open: false } as CanvasOverlaysProps['findSearch'],
  findNodesById: new Map(),
  onFindMatchActivate: vi.fn(),
  transform: { x: 0, y: 0, scale: 1 },
});

describe('CanvasOverlays selection actions', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    localStorage.clear();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  const render = (overrides: Partial<CanvasOverlaysProps> = {}) => {
    const props = { ...baseProps(), ...overrides };
    act(() => {
      root.render(
        createElement(
          I18nProvider,
          null,
          createElement(
            RightDockProvider,
            null,
            createElement(CanvasOverlays, props),
          ),
        ),
      );
    });
  };

  // The selection toolbar surface was removed on purpose (the SelectionToolbar
  // component, its selection props, and the --selection chrome CSS are gone).
  // This pins that the overlay tree does not grow it back silently.
  it('renders no selection toolbar', () => {
    render();

    expect(host.querySelector('[role="toolbar"][aria-label="Selection actions"]')).toBeNull();
    expect(host.querySelector('.canvas-bottom-chrome--selection')).toBeNull();
  });
});
