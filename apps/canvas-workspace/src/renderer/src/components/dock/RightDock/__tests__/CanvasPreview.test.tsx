// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentContextTabRef, CanvasNode } from '../../../../types';
import { I18nProvider } from '../../../../i18n';
import { AppShellProvider } from '../../../shell/AppShellProvider';
import type { ChatDeliveryReceipt } from '../../../chat/ChatTargetContext';

const controls = vi.hoisted(() => ({
  fitAllNodes: vi.fn(),
  zoomByStep: vi.fn(),
}));
const rendered = vi.hoisted(() => ({
  canvasProps: null as null | { isActive?: boolean; persistViewport?: boolean },
  surfaceReadOnly: undefined as boolean | undefined,
}));

vi.mock('../../../../hooks/useCanvas', () => ({
  useCanvas: () => ({
    transform: { x: 0, y: 0, scale: 1 },
    setTransform: vi.fn(),
    settledScale: 1,
    moving: false,
    handleWheel: vi.fn(),
    handleMouseDown: vi.fn(),
    handleMouseMove: vi.fn(),
    handleMouseUp: vi.fn(),
    zoomByStep: controls.zoomByStep,
  }),
}));

vi.mock('../../../../hooks/useCanvasFit', () => ({
  useCanvasFit: () => ({
    fitAllNodes: controls.fitAllNodes,
    handleFocusNode: vi.fn(),
  }),
}));

vi.mock('../../../canvas/Canvas/CanvasSurface', () => ({
  CanvasSurface: (props: { readOnly?: boolean }) => {
    rendered.surfaceReadOnly = props.readOnly;
    return <div data-testid="canvas-surface" />;
  },
}));

vi.mock('../../../canvas/Canvas', () => ({
  Canvas: (props: { isActive?: boolean; persistViewport?: boolean }) => {
    rendered.canvasProps = props;
    return <div data-testid="editable-canvas" />;
  },
}));

import { CanvasPreview } from '../CanvasPreview';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NODE = {
  id: 'node-1',
  type: 'text',
  title: 'Draft',
  x: 20,
  y: 30,
  width: 240,
  height: 160,
  data: { content: 'Hello' },
} as CanvasNode;

let root: Root | null = null;
let mount: HTMLDivElement | null = null;
let load: ReturnType<typeof vi.fn>;

const installStore = () => {
  Object.defineProperty(window, 'canvasWorkspace', {
    configurable: true,
    value: {
      store: {
        load,
        watchWorkspace: vi.fn(),
        onExternalUpdate: vi.fn(() => () => undefined),
      },
    },
  });
};

interface PreviewTestProps {
  tabRef?: AgentContextTabRef;
  onAddTabToChat?: (workspaceId: string, tab: AgentContextTabRef) => Promise<ChatDeliveryReceipt>;
  editingAllowed?: boolean;
  active?: boolean;
}

const previewTree = (props?: PreviewTestProps) => (
  <I18nProvider>
    <AppShellProvider>
      <CanvasPreview
        workspaceId="workspace-1"
        canvasName="Research"
        tabRef={props?.tabRef}
        targetWorkspaceId={props?.tabRef ? 'workspace-1' : undefined}
        onAddTabToChat={props?.onAddTabToChat}
        editingAllowed={props?.editingAllowed}
        active={props?.active}
      />
    </AppShellProvider>
  </I18nProvider>
);

const renderPreview = async (props?: PreviewTestProps) => {
  mount = document.createElement('div');
  document.body.appendChild(mount);
  root = createRoot(mount);
  await act(async () => {
    root?.render(previewTree(props));
    await Promise.resolve();
  });
};

const rerenderPreview = async (props?: PreviewTestProps) => {
  await act(async () => {
    root?.render(previewTree(props));
    await Promise.resolve();
  });
};

beforeEach(() => {
  load = vi.fn();
  controls.fitAllNodes.mockReset();
  controls.zoomByStep.mockReset();
  rendered.canvasProps = null;
  rendered.surfaceReadOnly = undefined;
  installStore();
  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    value: class ResizeObserverStub {
      observe() {}
      disconnect() {}
    },
  });
});

afterEach(() => {
  act(() => root?.unmount());
  mount?.remove();
  Reflect.deleteProperty(window, 'canvasWorkspace');
  Reflect.deleteProperty(globalThis, 'ResizeObserver');
  vi.restoreAllMocks();
  root = null;
  mount = null;
});

describe('CanvasPreview accessible read-only chrome', () => {
  it('offers editing only while the current host grants it, and never revives an old edit session', async () => {
    load.mockResolvedValue({
      ok: true,
      data: { nodes: [NODE], edges: [], transform: { x: 0, y: 0, scale: 1 } },
    });
    await renderPreview({ editingAllowed: true, active: true });

    await vi.waitFor(() => expect(mount?.querySelector('[data-testid="canvas-surface"]')).not.toBeNull());
    const edit = [...(mount?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
      .find((button) => button.textContent === 'Edit canvas');
    expect(edit).toBeDefined();
    expect(rendered.surfaceReadOnly).toBe(true);

    await act(async () => edit?.click());
    expect(mount?.querySelector('[data-testid="editable-canvas"]')).not.toBeNull();
    expect(mount?.querySelector('.canvas-preview')?.getAttribute('data-mode')).toBe('edit');
    expect(rendered.canvasProps).toMatchObject({ isActive: true, persistViewport: false });

    await rerenderPreview({ editingAllowed: false, active: true });
    expect(mount?.querySelector('[data-testid="editable-canvas"]')).toBeNull();
    expect(mount?.querySelector('.canvas-preview__read-only')?.textContent).toBe('Read-only preview');
    expect([...mount!.querySelectorAll('button')].some((button) => button.textContent === 'Edit canvas')).toBe(false);
    expect(rendered.surfaceReadOnly).toBe(true);

    await rerenderPreview({ editingAllowed: true, active: true });
    expect(mount?.querySelector('[data-testid="editable-canvas"]')).toBeNull();
    expect([...mount!.querySelectorAll('button')].some((button) => button.textContent === 'Edit canvas')).toBe(true);
  });

  it('labels the region and exposes local zoom controls without implying editability', async () => {
    load.mockResolvedValue({
      ok: true,
      data: { nodes: [NODE], edges: [], transform: { x: 0, y: 0, scale: 1 } },
    });
    await renderPreview();

    await vi.waitFor(() => expect(mount?.querySelector('[data-testid="canvas-surface"]')).not.toBeNull());
    const region = mount?.querySelector<HTMLElement>('[role="region"]');
    expect(region?.getAttribute('aria-label')).toBe('Research, read-only canvas preview');
    expect(region?.querySelector('.canvas-preview__read-only')?.textContent).toBe('Read-only preview');

    const toolbar = region?.querySelector<HTMLElement>('[role="toolbar"]');
    expect(toolbar?.getAttribute('aria-label')).toBe('Canvas preview zoom');
    expect(toolbar?.querySelector('[aria-label="Zoom level: 100%"]')?.textContent).toBe('100%');

    const zoomOut = toolbar?.querySelector<HTMLButtonElement>('[aria-label="Zoom out"]');
    const zoomIn = toolbar?.querySelector<HTMLButtonElement>('[aria-label="Zoom in"]');
    const fit = [...(toolbar?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
      .find((button) => button.textContent === 'Fit');
    if (!zoomOut || !zoomIn || !fit) throw new Error('Expected all local zoom controls');

    act(() => zoomOut.click());
    act(() => zoomIn.click());
    act(() => fit.click());

    expect(controls.zoomByStep).toHaveBeenNthCalledWith(1, 1 / 1.2, region);
    expect(controls.zoomByStep).toHaveBeenNthCalledWith(2, 1.2, region);
    expect(controls.fitAllNodes).toHaveBeenCalledWith([NODE]);
  });

  it('announces loading and turns a rejected load into a retryable error', async () => {
    let resolveRetry: ((value: unknown) => void) | undefined;
    load
      .mockRejectedValueOnce(new Error('disk unavailable'))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveRetry = resolve; }));
    await renderPreview();

    await vi.waitFor(() => expect(mount?.querySelector('[role="alert"]')).not.toBeNull());
    expect(mount?.querySelector('[role="alert"]')?.textContent).toContain('Could not load canvas');
    const retry = [...(mount?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
      .find((button) => button.textContent === 'Retry');
    if (!retry) throw new Error('Expected a retry action');

    act(() => retry.click());
    expect(mount?.querySelector('[role="status"]')?.textContent).toContain('Loading canvas');
    expect(load).toHaveBeenCalledTimes(2);

    await act(async () => {
      resolveRetry?.({ ok: true, data: { nodes: [], edges: [], transform: { x: 0, y: 0, scale: 1 } } });
    });
    await vi.waitFor(() => expect(mount?.querySelector('[role="alert"]')).toBeNull());
  });

  it('keeps the whole-canvas AI action available while loading and after an error', async () => {
    let rejectLoad: ((error: Error) => void) | undefined;
    load.mockImplementation(() => new Promise((_resolve, reject) => { rejectLoad = reject; }));
    const tabRef: AgentContextTabRef = {
      id: 'canvas:workspace-1',
      kind: 'canvas',
      title: 'Research',
      workspaceId: 'workspace-1',
      dockWorkspaceId: 'workspace-1',
    };
    await renderPreview({
      tabRef,
      onAddTabToChat: vi.fn(async () => ({ status: 'unavailable' as const, target: null })),
    });

    const findAction = () => mount?.querySelector('[aria-label="Add Research to the current conversation"]');
    expect(mount?.querySelector('[role="status"]')?.textContent).toContain('Loading canvas');
    expect(findAction()).not.toBeNull();

    await act(async () => rejectLoad?.(new Error('disk unavailable')));
    await vi.waitFor(() => expect(mount?.querySelector('[role="alert"]')).not.toBeNull());
    expect(findAction()).not.toBeNull();
  });

  it('offers the whole canvas to the current AI conversation', async () => {
    load.mockResolvedValue({
      ok: true,
      data: { nodes: [NODE], edges: [], transform: { x: 0, y: 0, scale: 1 } },
    });
    const tabRef: AgentContextTabRef = {
      id: 'canvas:workspace-1',
      kind: 'canvas',
      title: 'Research',
      workspaceId: 'workspace-1',
      dockWorkspaceId: 'workspace-1',
    };
    const onAddTabToChat = vi.fn(async () => ({
      status: 'delivered' as const,
      target: {
        surface: 'page' as const,
        scope: { kind: 'global' as const },
        scopeId: '__global_chat__',
        sessionId: null,
        composerId: 'page:global',
        contextSnapshot: { label: 'Global chat' },
        executionPolicy: 'auto' as const,
      },
    }));
    await renderPreview({ tabRef, onAddTabToChat });

    const button = mount?.querySelector<HTMLButtonElement>('[aria-label="Add Research to the current conversation"]');
    expect(button).not.toBeNull();
    await act(async () => button?.click());

    expect(onAddTabToChat).toHaveBeenCalledWith('workspace-1', tabRef);
    expect(document.body.textContent).toContain('Added to Global chat');
  });
});
