// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CanvasTransform } from '../../../../../../types';
import { useLocalViewportHandoff } from './useLocalViewportHandoff';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Props = Parameters<typeof useLocalViewportHandoff>[0];

const framing: CanvasTransform = { x: -40, y: 12, scale: 0.99 };
let root: Root;
let host: HTMLDivElement;
let setTransform: ReturnType<typeof vi.fn>;
let onViewportChange: ReturnType<typeof vi.fn>;
let hasAutoFittedRef: { current: boolean };

const Probe = (props: Props) => { useLocalViewportHandoff(props); return null; };
const render = (overrides: Partial<Props> = {}) => act(() => {
  root.render(<Probe
    persistViewport={false}
    initialViewport={framing}
    onViewportChange={onViewportChange}
    loaded
    moving={false}
    transform={framing}
    setTransform={setTransform}
    hasAutoFittedRef={hasAutoFittedRef}
    {...overrides}
  />);
});

beforeEach(() => {
  setTransform = vi.fn();
  onViewportChange = vi.fn();
  hasAutoFittedRef = { current: false };
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

it('starts an embedded editor from the host framing instead of auto-fitting', () => {
  render({ loaded: false });
  expect(setTransform).toHaveBeenCalledWith(framing);
  expect(hasAutoFittedRef.current).toBe(true);
  render({ loaded: false, initialViewport: { x: 0, y: 0, scale: 1 } });
  expect(setTransform).toHaveBeenCalledTimes(1);
});

it('reports only settled local viewports back to the host', () => {
  const panned = { x: -200, y: 40, scale: 0.99 };
  render({ moving: true, transform: panned });
  expect(onViewportChange).not.toHaveBeenCalled();
  render({ moving: false, transform: panned });
  expect(onViewportChange).toHaveBeenLastCalledWith(panned);
});

it('leaves a persisted viewport to the document', () => {
  render({ persistViewport: true });
  expect(setTransform).not.toHaveBeenCalled();
  expect(hasAutoFittedRef.current).toBe(false);
  expect(onViewportChange).not.toHaveBeenCalled();
});
