// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useViewportClampedPosition } from './useViewportClampedPosition';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let pos: { left: number; top: number };

const Probe = ({ y, flipAboveY }: { y: number; flipAboveY?: number }) => {
  const anchor = useViewportClampedPosition<HTMLDivElement>(20, y, flipAboveY);
  pos = anchor.pos;
  return <div ref={anchor.ref} />;
};

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(200);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(100);
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

describe('useViewportClampedPosition', () => {
  it('pulls a popup up from the bottom edge without a flip point', () => {
    act(() => root.render(<Probe y={700} />));
    expect(pos.top).toBe(592);
  });

  it('opens above the anchor when it has a flip point and no room below', () => {
    act(() => root.render(<Probe y={700} flipAboveY={680} />));
    expect(pos.top).toBe(480);
  });

  it('keeps a popup that fits below the anchor', () => {
    act(() => root.render(<Probe y={300} flipAboveY={280} />));
    expect(pos.top).toBe(300);
  });
});
