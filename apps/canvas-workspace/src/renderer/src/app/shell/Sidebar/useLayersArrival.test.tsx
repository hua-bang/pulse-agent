// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLayersArrival } from './useLayersArrival';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('useLayersArrival', () => {
  let host: HTMLDivElement;
  let root: Root;
  let arriving = false;
  let frames: FrameRequestCallback[] = [];

  const Probe = ({ hasLayers }: { hasLayers: boolean }) => {
    arriving = useLayersArrival(hasLayers);
    return null;
  };

  const render = (hasLayers: boolean) => act(() => root.render(<Probe hasLayers={hasLayers} />));

  const flushFrame = () => act(() => {
    const pending = frames;
    frames = [];
    pending.forEach((callback) => callback(0));
  });

  beforeEach(() => {
    frames = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback));
    vi.stubGlobal('cancelAnimationFrame', () => {});
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  // A reload paints the canvas before its nodes load. The panel must open in
  // the same commit as the instant flag, or it slides and shifts the canvas.
  it('flags the commit where layers arrive and clears it two frames later', () => {
    render(false);
    expect(arriving).toBe(false);

    render(true);
    expect(arriving).toBe(true);
    flushFrame();
    expect(arriving).toBe(true);
    flushFrame();
    expect(arriving).toBe(false);
  });

  it('flags the commit where the last layer goes', () => {
    render(true);
    expect(arriving).toBe(false);
    render(false);
    expect(arriving).toBe(true);
    flushFrame();
    flushFrame();
    expect(arriving).toBe(false);
  });

  it('does not flag a canvas that starts with its layers', () => {
    render(true);
    expect(arriving).toBe(false);
    expect(frames).toHaveLength(0);
  });
});
