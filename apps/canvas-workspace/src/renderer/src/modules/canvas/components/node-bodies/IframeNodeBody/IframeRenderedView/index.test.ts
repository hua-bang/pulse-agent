// @vitest-environment happy-dom
import { createElement, createRef, type RefObject } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../../../i18n';
import { IframeRenderedView } from '.';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

const divRef = () => createRef<HTMLDivElement>() as RefObject<HTMLDivElement>;
const iframeRef = () => createRef<HTMLIFrameElement>() as RefObject<HTMLIFrameElement>;

const renderUrlView = async () => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);

  await act(async () => root?.render(
    createElement(I18nProvider, null,
      createElement(IframeRenderedView, {
        artifact: null,
        artifactHtml: '',
        artifactId: null,
        cancel: vi.fn(),
        canGoBack: false,
        canGoForward: false,
        commit: vi.fn(),
        discardSnapshot: null,
        draftUrl: 'https://example.com',
        faviconUrl: undefined,
        frameHostRef: divRef(),
        generating: false,
        handleOpenExternal: vi.fn(),
        handleKeyDown: vi.fn(),
        handleGoBack: vi.fn(),
        handleGoForward: vi.fn(),
        handlePickDomElement: vi.fn(),
        handlePickReviewElement: vi.fn(),
        handleRegenerate: vi.fn(),
        handleReload: vi.fn(),
        html: '',
        isArtifactMode: false,
        isResizing: false,
        loadError: null,
        loadState: 'ready',
        localUrl: '',
        mode: 'url',
        nodeId: 'iframe-1',
        openArtifact: vi.fn(),
        domPickerActive: false,
        reviewPickerActive: false,
        readOnly: false,
        savedPrompt: '',
        setDraftUrl: vi.fn(),
        setEditing: vi.fn(),
        onWakeWebview: vi.fn(),
        renderIframeRef: iframeRef(),
        shouldMountInlineFrame: false,
        streamIframeRef: iframeRef(),
        streamingActive: false,
        webviewDiscarded: false,
        title: 'Example',
        url: 'https://example.com',
        webviewHostRef: divRef(),
        webviewKey: 1,
        workspaceId: 'workspace-a',
      }),
    ),
  ));
};

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe('IframeRenderedView toolbar', () => {
  it('hides the URL review comment action while preserving other URL actions', async () => {
    await renderUrlView();

    expect(host?.querySelector('[aria-label="Select DOM for AI Chat"]')).not.toBeNull();
    expect(host?.querySelector('[aria-label="Open externally"]')).not.toBeNull();
    expect(host?.querySelector('[aria-label="Add review comment"]')).toBeNull();
  });
});
