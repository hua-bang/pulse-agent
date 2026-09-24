// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useStableRowHandlers } from '../useStableRowHandlers';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Handlers = Parameters<typeof useStableRowHandlers>[0];

let root: Root | null = null;
let host: HTMLDivElement | null = null;
const results: Array<ReturnType<typeof useStableRowHandlers>> = [];

function Probe({ handlers }: { handlers: Handlers }) {
  results.push(useStableRowHandlers(handlers));
  return null;
}

function render(handlers: Handlers) {
  act(() => root!.render(createElement(Probe, { handlers })));
}

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  results.length = 0;
});

describe('useStableRowHandlers', () => {
  it('keeps row handler identities stable while forwarding to the latest surface handler', () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    const firstRegenerate = vi.fn();
    const latestRegenerate = vi.fn();
    const base = { onToggleSection: vi.fn(), onToggleToolExpand: vi.fn() };

    render({ ...base, onRegenerate: firstRegenerate });
    render({ ...base, onToggleSection: vi.fn(), onRegenerate: latestRegenerate });
    const [first, second] = results;

    expect(second.onToggleSection).toBe(first.onToggleSection);
    expect(second.onRegenerate).toBe(first.onRegenerate);
    second.onRegenerate?.(3);
    expect(latestRegenerate).toHaveBeenCalledWith(3);
    expect(firstRegenerate).not.toHaveBeenCalled();
  });

  it('leaves absent optional handlers undefined so rows hide their actions', () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);

    render({ onToggleSection: vi.fn(), onToggleToolExpand: vi.fn() });

    expect(results[0].onRegenerate).toBeUndefined();
    expect(results[0].onEditUserMessage).toBeUndefined();
  });
});
