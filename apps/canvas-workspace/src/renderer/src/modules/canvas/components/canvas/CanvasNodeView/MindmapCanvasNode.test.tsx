// @vitest-environment happy-dom
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../../i18n';
import type { CanvasNode } from '../../../../../types';
import { MindmapCanvasNode } from './MindmapCanvasNode';

vi.mock('../../node-bodies/MindmapNodeBody', () => ({
  MindmapNodeBody: () => <div data-testid="mindmap-body" />,
}));

vi.mock('../NodeContextMenu', () => ({
  NodeContextMenu: () => <div className="context-menu" />,
}));

const node: CanvasNode = {
  id: 'mindmap-1',
  type: 'mindmap',
  title: 'Strategy',
  x: 0,
  y: 0,
  width: 640,
  height: 480,
  data: {},
};

let host: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  root?.unmount();
  host?.remove();
  document.querySelectorAll('.context-menu').forEach((menu) => menu.remove());
  host = null;
  root = null;
});

describe('MindmapCanvasNode context menu', () => {
  it('does not expose an inert export menu when the host has no export capability', () => {
    renderMindmap();

    flushSync(() => {
      host?.firstElementChild?.dispatchEvent(new globalThis.MouseEvent('contextmenu', {
        bubbles: true,
        button: 2,
        clientX: 20,
        clientY: 30,
      }));
    });

    expect(document.querySelector('.context-menu')).toBeNull();
  });

  it('opens the export menu when the host provides the capability', () => {
    renderMindmap({ onExportMindmapImage: vi.fn() });

    flushSync(() => {
      host?.firstElementChild?.dispatchEvent(new globalThis.MouseEvent('contextmenu', {
        bubbles: true,
        button: 2,
        clientX: 20,
        clientY: 30,
      }));
    });

    expect(document.querySelector('.context-menu')).toBeInstanceOf(HTMLElement);
  });
});

function renderMindmap(overrides: Partial<Parameters<typeof MindmapCanvasNode>[0]> = {}) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);

  flushSync(() => {
    root?.render(
      <I18nProvider>
        <MindmapCanvasNode
          classes="canvas-node canvas-node--mindmap"
          handleClose={vi.fn()}
          handleNodeClick={vi.fn()}
          handleToggleFullscreen={vi.fn()}
          isDragging={false}
          isFullscreen={false}
          isSelected
          node={node}
          onAutoResize={vi.fn()}
          onDragStart={vi.fn()}
          onSelect={vi.fn()}
          onUpdate={vi.fn()}
          readOnly={false}
          supportsFullscreen={false}
          wrapperStyle={{}}
          {...overrides}
        />
      </I18nProvider>,
    );
  });
}
