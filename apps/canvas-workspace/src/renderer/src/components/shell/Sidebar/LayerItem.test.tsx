// @vitest-environment happy-dom
import { createRef } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CanvasNode } from '../../../types';
import { I18nProvider } from '../../../i18n';
import { LayerItem } from './LayerItem';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

const imageNode: CanvasNode = {
  id: 'image-1',
  type: 'image',
  title: 'Diagram screenshot',
  x: 0,
  y: 0,
  width: 240,
  height: 160,
  data: { filePath: '/tmp/diagram.png' },
};

describe('LayerItem', () => {
  it('keeps layer node icons monochrome even when the row is not selected', () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);

    act(() => {
      root?.render(
        <I18nProvider>
          <LayerItem
            tree={{ node: imageNode, children: [] }}
            collapsedLayers={new Set()}
            searchActive={false}
            selectedNodeIds={new Set()}
            onFocus={vi.fn()}
            onContextMenu={vi.fn()}
            onToggleCollapse={vi.fn()}
            onRegisterLayerButton={vi.fn()}
            onLayerKeyDown={vi.fn()}
            renamingLayerId={null}
            renameLayerValue=""
            renameLayerInputRef={createRef<HTMLInputElement>()}
            onRenameChange={vi.fn()}
            onRenameCommit={vi.fn()}
            onRenameCancel={vi.fn()}
          />
        </I18nProvider>,
      );
    });

    const icon = host.querySelector('.sidebar-layer-icon svg');
    expect(icon?.getAttribute('class')).toBe('canvas-node-icon');
    expect(icon?.getAttribute('style')).toBeNull();
  });
});
