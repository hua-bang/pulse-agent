// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../i18n';
import { RightDockProvider } from '../RightDock';
import { CanvasOverlays } from './CanvasOverlays';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type CanvasOverlaysProps = ComponentProps<typeof CanvasOverlays>;

const selectedNode = {
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
  nodes: [selectedNode],
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
  selectedNodeIds: [],
  findSearch: { open: false } as CanvasOverlaysProps['findSearch'],
  findNodesById: new Map(),
  onFindMatchActivate: vi.fn(),
  transform: { x: 0, y: 0, scale: 1 },
});

const clickButton = (host: HTMLElement, label: string) => {
  const button = host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  expect(button).not.toBeNull();
  act(() => button?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
};

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

  it('shows selection actions and forwards single-selection commands', () => {
    const onFitSelection = vi.fn();
    const onDuplicateSelection = vi.fn();
    const onToggleFocusMode = vi.fn();
    const onWrapSelectionInFrame = vi.fn();
    const onPinReferenceSelection = vi.fn();
    const onAddSelectionToChat = vi.fn();
    const onDeleteSelection = vi.fn();

    render({
      selectedNodeIds: ['node-1'],
      focusModeAvailable: true,
      onFitSelection,
      onDuplicateSelection,
      onToggleFocusMode,
      onWrapSelectionInFrame,
      onPinReferenceSelection,
      onAddSelectionToChat,
      onDeleteSelection,
    });

    expect(host.querySelector('[role="toolbar"][aria-label="Selection actions"]')).not.toBeNull();
    expect(host.querySelector('.canvas-bottom-chrome--selection')).not.toBeNull();

    clickButton(host, 'Fit the selection in view');
    clickButton(host, 'Duplicate selection');
    clickButton(host, 'Focus selection');
    clickButton(host, 'Wrap in frame');
    clickButton(host, 'Pin selection as reference');
    clickButton(host, 'Add selection to chat');
    clickButton(host, 'Delete selection');

    expect(onFitSelection).toHaveBeenCalledOnce();
    expect(onDuplicateSelection).toHaveBeenCalledOnce();
    expect(onToggleFocusMode).toHaveBeenCalledOnce();
    expect(onWrapSelectionInFrame).toHaveBeenCalledOnce();
    expect(onPinReferenceSelection).toHaveBeenCalledOnce();
    expect(onAddSelectionToChat).toHaveBeenCalledOnce();
    expect(onDeleteSelection).toHaveBeenCalledOnce();
  });

  it('keeps group available for a multi-selection', () => {
    const onGroupSelection = vi.fn();

    render({
      selectedNodeIds: ['node-1', 'node-2'],
      onGroupSelection,
    });

    expect(host.querySelector('[role="toolbar"][aria-label="Selection actions"]')).not.toBeNull();
    clickButton(host, 'Group selection');
    expect(onGroupSelection).toHaveBeenCalledOnce();
  });

  it('hides selection actions when the selection is empty', () => {
    render({ selectedNodeIds: [] });

    expect(host.querySelector('[role="toolbar"][aria-label="Selection actions"]')).toBeNull();
    expect(host.querySelector('.canvas-bottom-chrome--selection')).toBeNull();
  });
});
