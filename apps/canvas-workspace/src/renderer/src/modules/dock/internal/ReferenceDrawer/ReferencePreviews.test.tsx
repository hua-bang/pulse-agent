// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { I18nProvider } from '../../../../i18n';
import { IframeNodeBody } from '../../../canvas/iframe';
import { ReferencePreviewPanel } from './ReferencePreviews';
import type { UrlReferenceEntry } from '../../../../shared/reference/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../../canvas/iframe', () => ({
  IframeNodeBody: vi.fn(() => <div data-testid="iframe-preview" />),
}));

vi.mock('../RightDock', () => ({
  useRightDock: () => ({ openArtifact: vi.fn() }),
}));

let root: Root | null = null;
let host: HTMLDivElement | null = null;

const iframeNodeBodyMock = vi.mocked(IframeNodeBody);

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.clearAllMocks();
});

describe('ReferencePreviewPanel', () => {
  it('registers URL previews under the active workspace so the gated webview can navigate', async () => {
    const reference: UrlReferenceEntry = {
      kind: 'url',
      id: 'url-reference-1',
      url: 'https://bytedance.larkoffice.com/wiki/example',
      title: 'Lark doc',
    };

    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);

    await act(async () => {
      root?.render(
        <I18nProvider>
          <ReferencePreviewPanel
            activeWorkspaceId="workspace-active"
            references={[reference]}
            activeReference={reference}
            copyUrl={vi.fn()}
            drawerWidth={420}
            getNodeByEntry={() => undefined}
            onAddReferenceToCanvas={vi.fn()}
            onClearAll={vi.fn()}
            onFocusNode={vi.fn()}
            onOpenUrl={vi.fn()}
            onRemoveReference={vi.fn()}
            workspaceNameById={new Map()}
          />
        </I18nProvider>,
      );
    });

    await act(async () => {
      await Promise.resolve();
    });

    const iframeProps = iframeNodeBodyMock.mock.calls.at(-1)?.[0] as ComponentProps<typeof IframeNodeBody> | undefined;
    expect(iframeProps?.workspaceId).toBe('workspace-active');
    expect(iframeProps?.node.data).toMatchObject({
      mode: 'url',
      url: reference.url,
    });
    expect(iframeProps?.readOnly).toBe(true);
  });
});
