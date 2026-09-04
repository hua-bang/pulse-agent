// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../../../i18n';
import type { CanvasNode } from '../../../../../../types';
import { ShapeStylePicker } from './index';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe('ShapeStylePicker', () => {
  it('patches only the chosen style field while preserving shape data', () => {
    const onUpdate = vi.fn();
    const node: CanvasNode = {
      id: 'shape-1',
      type: 'shape',
      title: 'Shape',
      x: 0,
      y: 0,
      width: 200,
      height: 120,
      data: {
        kind: 'rect',
        fill: '#FFFFFF',
        stroke: '#1F2328',
        strokeWidth: 2,
        text: 'Keep me',
      },
    };
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);

    act(() => {
      root?.render(
        <I18nProvider>
          <ShapeStylePicker node={node} onUpdate={onUpdate} />
        </I18nProvider>,
      );
    });
    act(() => host?.querySelector<HTMLButtonElement>('button[aria-label="Shape style"]')?.click());
    act(() => host?.querySelector<HTMLButtonElement>('button[aria-label="Use 4px stroke width"]')?.click());

    expect(onUpdate).toHaveBeenCalledWith('shape-1', {
      data: { ...node.data, strokeWidth: 4 },
    });
  });
});
