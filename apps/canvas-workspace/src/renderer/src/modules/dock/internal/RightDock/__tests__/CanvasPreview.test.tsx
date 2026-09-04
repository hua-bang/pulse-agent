// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AgentContextDomReviewComment,
  AgentContextTabRef,
  CanvasEdge,
  CanvasNode,
} from '../../../../../types';
import { I18nProvider } from '../../../../../i18n';
import { AppShellProvider } from '../../../../../app/shell/AppShellProvider';
import type { ChatDeliveryReceipt } from '../../../../chat';
import type { CanvasClipboard } from '../../../../../types/ui-interaction';

const controls = vi.hoisted(() => ({
  fitAllNodes: vi.fn(),
  zoomByStep: vi.fn(),
}));
const rendered = vi.hoisted(() => ({
  canvasProps: null as null | {
    isActive?: boolean;
    keyboardActive?: boolean;
    persistViewport?: boolean;
    clipboard?: CanvasClipboard | null;
    onClipboardChange?: (clipboard: CanvasClipboard | null) => void;
    onNodesChange?: (canvasId: string, nodes: CanvasNode[]) => void;
    onEdgesChange?: (canvasId: string, edges: CanvasEdge[]) => void;
    onSubmitDomReviewComments?: (comments: AgentContextDomReviewComment[]) => Promise<boolean>;
  },
  surfaceNodes: undefined as CanvasNode[] | undefined,
  surfaceEdges: undefined as CanvasEdge[] | undefined,
  surfaceReadOnly: undefined as boolean | undefined,
}));

vi.mock('../../../../canvas', () => ({
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
  useCanvasFit: () => ({
    fitAllNodes: controls.fitAllNodes,
    handleFocusNode: vi.fn(),
  }),
}));

vi.mock('../../../../canvas/surface', () => ({
  CanvasSurface: (props: { nodes?: CanvasNode[]; edges?: CanvasEdge[]; readOnly?: boolean }) => {
    rendered.surfaceNodes = props.nodes;
    rendered.surfaceEdges = props.edges;
    rendered.surfaceReadOnly = props.readOnly;
    return <div data-testid="canvas-surface" />;
  },
  Canvas: (props: {
    isActive?: boolean;
    keyboardActive?: boolean;
    persistViewport?: boolean;
    clipboard?: CanvasClipboard | null;
    onClipboardChange?: (clipboard: CanvasClipboard | null) => void;
    onNodesChange?: (canvasId: string, nodes: CanvasNode[]) => void;
    onEdgesChange?: (canvasId: string, edges: CanvasEdge[]) => void;
    onSubmitDomReviewComments?: (comments: AgentContextDomReviewComment[]) => Promise<boolean>;
  }) => {
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
let externalUpdateListener: ((event: {
  workspaceId: string;
  nodeIds?: string[];
  edgeIds?: string[];
}) => void) | undefined;

const installStore = () => {
  Object.defineProperty(window, 'canvasWorkspace', {
    configurable: true,
    value: {
      store: {
        load,
        watchWorkspace: vi.fn(),
        onExternalUpdate: vi.fn((listener) => {
          externalUpdateListener = listener;
          return () => {
            if (externalUpdateListener === listener) externalUpdateListener = undefined;
          };
        }),
      },
    },
  });
};

interface PreviewTestProps {
  workspaceId?: string;
  tabRef?: AgentContextTabRef;
  onAddTabToChat?: (workspaceId: string, tab: AgentContextTabRef) => Promise<ChatDeliveryReceipt>;
  onSubmitDomReviewComments?: (
    workspaceId: string,
    comments: AgentContextDomReviewComment[],
  ) => Promise<boolean>;
  editingAllowed?: boolean;
  active?: boolean;
}

const previewTree = (props?: PreviewTestProps) => (
  <I18nProvider>
    <AppShellProvider>
      <CanvasPreview
        workspaceId={props?.workspaceId ?? 'workspace-1'}
        canvasName="Research"
        tabRef={props?.tabRef}
        targetWorkspaceId={props?.tabRef ? 'workspace-1' : undefined}
        onAddTabToChat={props?.onAddTabToChat}
        onSubmitDomReviewComments={props?.onSubmitDomReviewComments}
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
  rendered.surfaceNodes = undefined;
  rendered.surfaceEdges = undefined;
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
  it('does not let a previous workspace load overwrite the current preview', async () => {
    let resolvePreviousWorkspace: ((value: unknown) => void) | undefined;
    const previousNode = { ...NODE, id: 'previous-node', title: 'Previous workspace' };
    const currentNode = { ...NODE, id: 'current-node', title: 'Current workspace' };
    load
      .mockImplementationOnce(() => new Promise((resolve) => { resolvePreviousWorkspace = resolve; }))
      .mockResolvedValueOnce({
        ok: true,
        data: { nodes: [currentNode], edges: [], transform: { x: 0, y: 0, scale: 1 } },
      });
    await renderPreview({ workspaceId: 'workspace-previous' });

    await rerenderPreview({ workspaceId: 'workspace-current' });
    await vi.waitFor(() => expect(rendered.surfaceNodes).toEqual([currentNode]));
    await act(async () => resolvePreviousWorkspace?.({
      ok: true,
      data: { nodes: [previousNode], edges: [], transform: { x: 0, y: 0, scale: 1 } },
    }));

    expect(rendered.surfaceNodes).toEqual([currentNode]);
  });

  it('ignores a stale preview reload that started before Edit and resolves during editing', async () => {
    let resolveStaleReload: ((value: unknown) => void) | undefined;
    const staleNode = { ...NODE, title: 'Stale disk title' };
    const editedNode = { ...NODE, title: 'Edited in AI Chat' };
    const editedEdge: CanvasEdge = {
      id: 'edge-edited',
      source: { kind: 'point', x: 20, y: 30 },
      target: { kind: 'point', x: 160, y: 180 },
    };
    load
      .mockResolvedValueOnce({
        ok: true,
        data: { nodes: [NODE], edges: [], transform: { x: 0, y: 0, scale: 1 } },
      })
      .mockImplementationOnce(() => new Promise((resolve) => { resolveStaleReload = resolve; }));
    await renderPreview({ editingAllowed: true, active: true });
    await vi.waitFor(() => expect(mount?.querySelector('[data-testid="canvas-surface"]')).not.toBeNull());

    act(() => externalUpdateListener?.({ workspaceId: 'workspace-1', nodeIds: [NODE.id] }));
    expect(load).toHaveBeenCalledTimes(2);
    const edit = [...(mount?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
      .find((button) => button.textContent === 'Edit canvas');
    await act(async () => edit?.click());
    act(() => {
      rendered.canvasProps?.onNodesChange?.('workspace-1', [editedNode]);
      rendered.canvasProps?.onEdgesChange?.('workspace-1', [editedEdge]);
    });

    await act(async () => resolveStaleReload?.({
      ok: true,
      data: { nodes: [staleNode], edges: [], transform: { x: 0, y: 0, scale: 1 } },
    }));
    expect(mount?.querySelector('[data-testid="editable-canvas"]')).not.toBeNull();

    const done = [...(mount?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
      .find((button) => button.textContent === 'Done');
    await act(async () => done?.click());

    expect(rendered.surfaceNodes).toEqual([editedNode]);
    expect(rendered.surfaceEdges).toEqual([editedEdge]);
  });

  it('keeps Edit mounted when an older reload fails and resumes preview reloads after Done', async () => {
    let rejectStaleReload: ((error: Error) => void) | undefined;
    const refreshedNode = { ...NODE, title: 'Reloaded after Done' };
    load
      .mockResolvedValueOnce({
        ok: true,
        data: { nodes: [NODE], edges: [], transform: { x: 0, y: 0, scale: 1 } },
      })
      .mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectStaleReload = reject; }))
      .mockResolvedValueOnce({
        ok: true,
        data: { nodes: [refreshedNode], edges: [], transform: { x: 0, y: 0, scale: 1 } },
      });
    await renderPreview({ editingAllowed: true, active: true });
    await vi.waitFor(() => expect(mount?.querySelector('[data-testid="canvas-surface"]')).not.toBeNull());

    act(() => externalUpdateListener?.({ workspaceId: 'workspace-1', nodeIds: [NODE.id] }));
    expect(load).toHaveBeenCalledTimes(2);
    const edit = [...(mount?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
      .find((button) => button.textContent === 'Edit canvas');
    await act(async () => edit?.click());

    // The canonical Canvas now owns this update; the preview must not launch a
    // competing disk read while editing.
    act(() => externalUpdateListener?.({ workspaceId: 'workspace-1', edgeIds: ['edge-1'] }));
    expect(load).toHaveBeenCalledTimes(2);
    await act(async () => rejectStaleReload?.(new Error('stale read failed')));
    expect(mount?.querySelector('[data-testid="editable-canvas"]')).not.toBeNull();
    expect(mount?.querySelector('[role="alert"]')).toBeNull();

    const done = [...(mount?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
      .find((button) => button.textContent === 'Done');
    await act(async () => done?.click());
    await act(async () => {
      externalUpdateListener?.({ workspaceId: 'workspace-1', nodeIds: [NODE.id] });
      await Promise.resolve();
    });

    await vi.waitFor(() => expect(rendered.surfaceNodes).toEqual([refreshedNode]));
    expect(load).toHaveBeenCalledTimes(3);
  });

  it('keeps edited connections in the immediate preview after Done', async () => {
    load.mockResolvedValue({
      ok: true,
      data: { nodes: [NODE], edges: [], transform: { x: 0, y: 0, scale: 1 } },
    });
    const edge: CanvasEdge = {
      id: 'edge-1',
      source: { kind: 'point', x: 20, y: 30 },
      target: { kind: 'point', x: 160, y: 180 },
    };
    await renderPreview({ editingAllowed: true, active: true });
    await vi.waitFor(() => expect(mount?.querySelector('[data-testid="canvas-surface"]')).not.toBeNull());

    const edit = [...(mount?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
      .find((button) => button.textContent === 'Edit canvas');
    await act(async () => edit?.click());
    act(() => rendered.canvasProps?.onEdgesChange?.('workspace-1', [edge]));

    const done = [...(mount?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
      .find((button) => button.textContent === 'Done');
    await act(async () => done?.click());

    expect(rendered.surfaceEdges).toEqual([edge]);
  });

  it('routes iframe review comments from the editable canvas to Chat', async () => {
    load.mockResolvedValue({
      ok: true,
      data: { nodes: [NODE], edges: [], transform: { x: 0, y: 0, scale: 1 } },
    });
    const comments: AgentContextDomReviewComment[] = [{
      id: 'review-1',
      text: 'Increase contrast',
      selection: { id: 'dom-1', label: 'Button', nodeId: 'node-1', selector: '#button' },
    }];
    const onSubmitDomReviewComments = vi.fn(async () => true);
    await renderPreview({ editingAllowed: true, active: true, onSubmitDomReviewComments });
    await vi.waitFor(() => expect(mount?.querySelector('[data-testid="canvas-surface"]')).not.toBeNull());

    const edit = [...(mount?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
      .find((button) => button.textContent === 'Edit canvas');
    await act(async () => edit?.click());
    const submitted = await rendered.canvasProps?.onSubmitDomReviewComments?.(comments);

    expect(submitted).toBe(true);
    expect(onSubmitDomReviewComments).toHaveBeenCalledWith('workspace-1', comments);
  });

  it('owns canvas shortcuts only after interaction inside the editable pane', async () => {
    load.mockResolvedValue({
      ok: true,
      data: { nodes: [NODE], edges: [], transform: { x: 0, y: 0, scale: 1 } },
    });
    await renderPreview({ editingAllowed: true, active: true });
    await vi.waitFor(() => expect(mount?.querySelector('[data-testid="canvas-surface"]')).not.toBeNull());

    const edit = [...(mount?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
      .find((button) => button.textContent === 'Edit canvas');
    await act(async () => edit?.click());
    expect(rendered.canvasProps?.isActive).toBe(true);
    expect(rendered.canvasProps?.keyboardActive).toBe(true);

    act(() => document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
    expect(rendered.canvasProps?.isActive).toBe(true);
    expect(rendered.canvasProps?.keyboardActive).toBe(false);

    act(() => mount?.querySelector('.canvas-preview')?.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true }),
    ));
    expect(rendered.canvasProps?.isActive).toBe(true);
    expect(rendered.canvasProps?.keyboardActive).toBe(true);

    await rerenderPreview({ editingAllowed: true, active: false });
    expect(rendered.canvasProps?.isActive).toBe(false);
    expect(rendered.canvasProps?.keyboardActive).toBe(false);

    await rerenderPreview({ editingAllowed: true, active: true });
    expect(rendered.canvasProps?.isActive).toBe(true);
    expect(rendered.canvasProps?.keyboardActive).toBe(false);
  });

  it('restores canvas shortcut and paste ownership after the app regains focus', async () => {
    load.mockResolvedValue({
      ok: true,
      data: { nodes: [NODE], edges: [], transform: { x: 0, y: 0, scale: 1 } },
    });
    await renderPreview({ editingAllowed: true, active: true });
    await vi.waitFor(() => expect(mount?.querySelector('[data-testid="canvas-surface"]')).not.toBeNull());

    const edit = [...(mount?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
      .find((button) => button.textContent === 'Edit canvas');
    await act(async () => edit?.click());
    expect(rendered.canvasProps?.keyboardActive).toBe(true);

    act(() => window.dispatchEvent(new Event('blur')));
    expect(rendered.canvasProps?.keyboardActive).toBe(false);

    act(() => window.dispatchEvent(new Event('focus')));
    expect(rendered.canvasProps?.keyboardActive).toBe(true);
  });

  it('keeps a same-workspace node clipboard inside the editable tab', async () => {
    load.mockResolvedValue({
      ok: true,
      data: { nodes: [NODE], edges: [], transform: { x: 0, y: 0, scale: 1 } },
    });
    await renderPreview({ editingAllowed: true, active: true });
    await vi.waitFor(() => expect(mount?.querySelector('[data-testid="canvas-surface"]')).not.toBeNull());

    const edit = [...(mount?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
      .find((button) => button.textContent === 'Edit canvas');
    await act(async () => edit?.click());
    expect(rendered.canvasProps?.clipboard).toBeNull();

    const clipboard: CanvasClipboard = {
      sourceWorkspaceId: 'workspace-1',
      nodes: [NODE],
      systemText: NODE.title,
    };
    act(() => rendered.canvasProps?.onClipboardChange?.(clipboard));

    expect(rendered.canvasProps?.clipboard).toEqual(clipboard);
  });

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
    expect(document.body.textContent).toContain('Added to AI Chat');
  });
});
