// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../../i18n';
import { loadMessages } from '../../../../../i18n/messages';
import { CanvasLoadState } from './CanvasRootView';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeAll(() => loadMessages('zh'));

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  window.localStorage.removeItem('pulse-canvas.language');
});

const render = async (failed: boolean, onRetry = vi.fn()) => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(
      <I18nProvider>
        <CanvasLoadState failed={failed} onRetry={onRetry} />
      </I18nProvider>,
    );
  });
  return onRetry;
};

describe('CanvasLoadState', () => {
  it('shows a loading status until the read fails', async () => {
    await render(false);
    expect(host.querySelector('[role="status"]')?.textContent).toContain('Loading canvas');
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.textContent).not.toContain('Saving failed');
  });

  it('offers a reload for a read failure and does not call it a save failure', async () => {
    window.localStorage.setItem('pulse-canvas.language', 'zh');
    const onRetry = await render(true);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('无法读取画布');
    expect(host.textContent).not.toContain('保存失败');
    expect(host.textContent).not.toContain('Saving failed');
    expect(host.querySelector('[role="status"]')).toBeNull();
    const button = host.querySelector('button');
    expect(button?.textContent).toBe('重新加载');
    await act(async () => { button?.click(); });
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
