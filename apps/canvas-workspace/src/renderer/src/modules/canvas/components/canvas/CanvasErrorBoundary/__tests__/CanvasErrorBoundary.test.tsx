// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../../../i18n';
import { CanvasErrorBoundary, NodeErrorFallback } from '..';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let shouldThrow = true;

const Flaky = ({ label }: { label: string }) => {
  if (shouldThrow) throw new Error('boom');
  return <span data-testid="ok">{label}</span>;
};

beforeEach(() => {
  shouldThrow = true;
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

describe('CanvasErrorBoundary', () => {
  it('contains a failing node and keeps its siblings mounted', async () => {
    const onRemove = vi.fn();
    await act(async () => {
      root.render(
        <I18nProvider>
          <CanvasErrorBoundary
            scope="node:a"
            fallback={(retry) => (
              <NodeErrorFallback title="Broken" style={{ left: 10, top: 20 }} onRetry={retry} onRemove={onRemove} />
            )}
          >
            <Flaky label="a" />
          </CanvasErrorBoundary>
          <span data-testid="sibling">b</span>
        </I18nProvider>,
      );
    });

    expect(host.querySelector('[data-testid="sibling"]')).not.toBeNull();
    const fallback = host.querySelector<HTMLElement>('.canvas-error-fallback--node');
    expect(fallback?.textContent).toContain('Broken');
    expect(fallback?.style.left).toBe('10px');

    const [, removeButton] = Array.from(host.querySelectorAll('button'));
    await act(async () => removeButton.click());
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('remounts the children when Retry is pressed', async () => {
    await act(async () => {
      root.render(
        <I18nProvider>
          <CanvasErrorBoundary
            scope="node:a"
            fallback={(retry) => <button type="button" onClick={retry}>retry</button>}
          >
            <Flaky label="recovered" />
          </CanvasErrorBoundary>
        </I18nProvider>,
      );
    });
    expect(host.querySelector('[data-testid="ok"]')).toBeNull();

    shouldThrow = false;
    await act(async () => host.querySelector('button')?.click());
    expect(host.querySelector('[data-testid="ok"]')?.textContent).toBe('recovered');
  });
});
