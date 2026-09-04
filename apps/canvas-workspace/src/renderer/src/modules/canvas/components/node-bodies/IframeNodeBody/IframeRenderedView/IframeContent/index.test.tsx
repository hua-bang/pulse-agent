// @vitest-environment happy-dom
import { act, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../../../../i18n';
import { IframeContent } from '.';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('IframeContent', () => {
  it('shows a discarded snapshot and delegates waking the webview', () => {
    const onWake = vi.fn();
    const host = document.createElement('div');
    const root = createRoot(host);
    act(() => {
      root.render(
        <I18nProvider>
          <IframeContent
            view={{ renderMode: 'url', url: 'https://example.com', streamingActive: false, isArtifactMode: false, artifact: null, inspectableHtml: '', localUrl: '', nodeId: 'node-1', shouldMountInlineFrame: false, webviewDiscarded: true, discardSnapshot: 'data:image/png;base64,abc', loadState: 'ready', loadError: null, webviewKey: 1 }}
            refs={{ frameHostRef: createRef(), renderIframeRef: createRef(), streamIframeRef: createRef(), webviewHostRef: createRef() }}
            actions={{ reload: vi.fn(), openExternal: vi.fn(), wakeWebview: onWake }}
          />
        </I18nProvider>,
      );
    });
    expect(host.querySelector<HTMLImageElement>('.iframe-discarded-snapshot')?.src).toContain('data:image/png');
    act(() => { host.querySelector<HTMLElement>('[role="button"]')?.click(); });
    expect(onWake).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
  });
});
