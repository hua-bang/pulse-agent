// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { clampIndexMove, indexNavEnd, indexNavHome, useIndexNav, type UseIndexNavResult } from '../hooks/useIndexNav';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe('clampIndexMove', () => {
  it('clamps at the top edge by default (no wrap)', () => {
    expect(clampIndexMove(0, -1, 5)).toBe(0);
  });

  it('clamps at the bottom edge by default (no wrap)', () => {
    expect(clampIndexMove(4, 1, 5)).toBe(4);
  });

  it('steps within bounds', () => {
    expect(clampIndexMove(2, 1, 5)).toBe(3);
    expect(clampIndexMove(2, -1, 5)).toBe(1);
  });

  it('wraps around when wrap: true', () => {
    expect(clampIndexMove(0, -1, 5, { wrap: true })).toBe(4);
    expect(clampIndexMove(4, 1, 5, { wrap: true })).toBe(0);
  });

  it('returns 0 for an empty list', () => {
    expect(clampIndexMove(0, 1, 0)).toBe(0);
  });
});

describe('indexNavHome / indexNavEnd', () => {
  it('home is always 0', () => {
    expect(indexNavHome()).toBe(0);
  });

  it('end is length - 1, floored at 0', () => {
    expect(indexNavEnd(5)).toBe(4);
    expect(indexNavEnd(0)).toBe(0);
  });
});

describe('useIndexNav', () => {
  function renderHook(): { get: () => UseIndexNavResult } {
    let latest!: UseIndexNavResult;
    const Probe = () => {
      latest = useIndexNav();
      return null;
    };
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root?.render(<Probe />);
    });
    return { get: () => latest };
  }

  it('starts at index 0', () => {
    const { get } = renderHook();
    expect(get().index).toBe(0);
  });

  it('move() clamps at the edges', () => {
    const { get } = renderHook();
    act(() => get().move(-1, 3));
    expect(get().index).toBe(0);
    act(() => get().move(1, 3));
    act(() => get().move(1, 3));
    act(() => get().move(1, 3));
    expect(get().index).toBe(2);
  });

  it('home() and end() jump to the edges', () => {
    const { get } = renderHook();
    act(() => get().move(1, 5));
    act(() => get().end(5));
    expect(get().index).toBe(4);
    act(() => get().home());
    expect(get().index).toBe(0);
  });

  it('setIndex() jumps directly (pointer hover/focus use case)', () => {
    const { get } = renderHook();
    act(() => get().setIndex(3));
    expect(get().index).toBe(3);
  });

  it('reset() defaults to 0 and accepts an explicit index', () => {
    const { get } = renderHook();
    act(() => get().setIndex(3));
    act(() => get().reset());
    expect(get().index).toBe(0);
    act(() => get().reset(2));
    expect(get().index).toBe(2);
  });
});
