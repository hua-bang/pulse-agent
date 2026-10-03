// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImageNodeBody } from './index';
import type { CanvasNode } from '../../../../../types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
const getImagePreview = vi.fn();
const node = (filePath: unknown): CanvasNode => ({
  id: 'image', type: 'image', title: 'Image', x: 0, y: 0, width: 200, height: 150,
  data: { filePath } as CanvasNode['data'],
});
const render = async (filePath: unknown, isFullscreen = false) => {
  await act(async () => root.render(
    <ImageNodeBody node={node(filePath)} isFullscreen={isFullscreen} onSelect={vi.fn()} onDragStart={vi.fn()} readOnly />,
  ));
};

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  getImagePreview.mockReset().mockResolvedValue({ ok: true, preview: { path: '/cache/preview.png' } });
  window.canvasWorkspace = { file: { getImagePreview } } as never;
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('ImageNodeBody path validation and recovery', () => {
  it.each([42, { path: '/tmp/image.png' }, ['/tmp/image.png'], true, null, undefined])(
    'does not request or render an invalid path (%j)', async (filePath) => {
      await render(filePath);
      expect(getImagePreview).not.toHaveBeenCalled();
      expect(host.querySelector('img')).toBeNull();
      expect(host.textContent).toContain('No image');
      await render(filePath, true);
      expect(host.querySelector('img')).toBeNull();
    },
  );

  it('renders valid previews and the original in fullscreen', async () => {
    await render('/tmp/original.png');
    expect(getImagePreview).toHaveBeenCalledWith('/tmp/original.png');
    expect(host.querySelector('img')?.getAttribute('src')).toBe('pulse-canvas://local/cache/preview.png');
    await render('/tmp/original.png', true);
    expect(host.querySelector('img')?.getAttribute('src')).toBe('pulse-canvas://local/tmp/original.png');
  });

  it.each(['reject', 'throw', 'invalid-result', 'not-ok'])('falls back safely after %s', async (failure) => {
    if (failure === 'reject') getImagePreview.mockRejectedValue(new Error('IPC failed'));
    if (failure === 'throw') getImagePreview.mockImplementation(() => { throw new Error('Bridge failed'); });
    if (failure === 'invalid-result') getImagePreview.mockResolvedValue({ ok: true, preview: { path: 42 } });
    if (failure === 'not-ok') getImagePreview.mockResolvedValue({ ok: false });
    await render('/tmp/original.png');
    expect(host.querySelector('img')?.getAttribute('src')).toBe('pulse-canvas://local/tmp/original.png');
  });

  it('falls back from a broken preview, then displays failure, and recovers on a new path', async () => {
    await render('/tmp/original.png');
    act(() => host.querySelector('img')!.dispatchEvent(new Event('error')));
    expect(host.querySelector('img')?.getAttribute('src')).toBe('pulse-canvas://local/tmp/original.png');
    act(() => host.querySelector('img')!.dispatchEvent(new Event('error')));
    expect(host.textContent).toContain('Image unavailable');
    await render('/tmp/replacement.png');
    expect(host.querySelector('img')).not.toBeNull();
  });
});
