// @vitest-environment happy-dom
import type { ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppShellPortProvider, type AppShellPort } from '../../../../../shared/appShell';
import type { CanvasNode } from '../../../../../types';
import { ImageCanvasNode } from './ImageCanvasNode';
import { ShapeCanvasNode } from './ShapeCanvasNode';

vi.mock('../../node-bodies/ImageNodeBody', () => ({ ImageNodeBody: () => null }));
vi.mock('../../node-bodies/ShapeNodeBody', () => ({
  ShapeNodeBody: () => null,
  ShapeStylePicker: () => null,
}));

const appShell = { notify: vi.fn() } as unknown as AppShellPort;

const baseNode = { x: 0, y: 0, width: 200, height: 120 };
const imageNode = { ...baseNode, id: 'image-1', type: 'image', title: 'Screenshot', data: { filePath: '/tmp/a.png' } } as CanvasNode;
const shapeNode = { ...baseNode, id: 'shape-1', type: 'shape', title: 'Box', data: {} } as CanvasNode;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  root?.unmount();
  host?.remove();
  root = null;
  host = null;
});

const render = (element: ReactNode) => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  flushSync(() => {
    root?.render(<AppShellPortProvider value={appShell}>{element}</AppShellPortProvider>);
  });
  return host;
};

const sharedProps = {
  classes: 'canvas-node',
  handleClose: vi.fn(),
  handleNodeClick: vi.fn(),
  makeResizeHandler: () => vi.fn(),
  onDragStart: vi.fn(),
  onSelect: vi.fn(),
  readOnly: false,
  wrapperStyle: {},
};

describe('floating add-to-chat on header-less nodes', () => {
  it.each([
    ['image', (handleAddToChat?: () => void) => (
      <ImageCanvasNode
        {...sharedProps}
        handleAddToChat={handleAddToChat}
        handleToggleFullscreen={vi.fn()}
        isFullscreen={false}
        node={imageNode}
        supportsFullscreen
      />
    )],
    ['shape', (handleAddToChat?: () => void) => (
      <ShapeCanvasNode
        {...sharedProps}
        handleAddToChat={handleAddToChat}
        isSelected={false}
        node={shapeNode}
        onUpdate={vi.fn()}
      />
    )],
  ])('renders and wires the %s node chat button', (_type, renderNode) => {
    const handleAddToChat = vi.fn();
    const container = render(renderNode(handleAddToChat));
    const button = container.querySelector<HTMLButtonElement>('.node-add-to-chat--floating');

    expect(button).not.toBeNull();
    button?.click();
    expect(handleAddToChat).toHaveBeenCalledTimes(1);
  });

  it('omits the button when no chat target is wired', () => {
    const container = render(
      <ShapeCanvasNode {...sharedProps} isSelected={false} node={shapeNode} onUpdate={vi.fn()} />,
    );

    expect(container.querySelector('.node-add-to-chat')).toBeNull();
  });
});
