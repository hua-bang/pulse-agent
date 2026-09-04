import { useEffect, type RefObject } from 'react';
import './index.css';
import type { Artifact } from '../../../../../../../types';
import { Button } from '../../../../../../../components/ui';
import { STREAMING_SHELL } from '../../../../../../artifacts/rendering';
import { markOnce } from '../../../../../../../perf/monitor';
import { useI18n } from '../../../../../../../i18n';
import { IframeOverviewBadge } from '../../IframeOverviewBadge';
import type { LoadState } from '../../types';

interface IframeContentView {
  renderMode: 'url' | 'html';
  mode?: string;
  url: string;
  title?: string;
  faviconUrl?: string;
  streamingActive: boolean;
  isResizing?: boolean;
  isArtifactMode: boolean;
  artifact: Artifact | null;
  inspectableHtml: string;
  localUrl: string;
  nodeId: string;
  shouldMountInlineFrame: boolean;
  webviewDiscarded: boolean;
  discardSnapshot: string | null;
  loadState: LoadState;
  loadError: string | null;
  webviewKey: number;
}

interface IframeContentRefs {
  frameHostRef: RefObject<HTMLDivElement>;
  renderIframeRef: RefObject<HTMLIFrameElement>;
  streamIframeRef: RefObject<HTMLIFrameElement>;
  webviewHostRef: RefObject<HTMLDivElement>;
}

interface IframeContentActions {
  reload: () => void;
  openExternal: () => void;
  wakeWebview: () => void;
}

export const IframeContent = ({
  view,
  refs,
  actions,
}: {
  view: IframeContentView;
  refs: IframeContentRefs;
  actions: IframeContentActions;
}) => {
  const { t } = useI18n();
  useEffect(() => {
    if (view.nodeId !== 'node-welcome-download' || !view.localUrl) return undefined;
    const handleMessage = (event: MessageEvent) => {
      if (event.source !== refs.renderIframeRef.current?.contentWindow) return;
      if (event.data?.type === 'pulse-canvas-welcome-content-ready') {
        markOnce('welcome:local-content-ready');
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [refs.renderIframeRef, view.localUrl, view.nodeId]);

  return (
    <div className={`iframe-frame-wrapper${view.streamingActive ? ' iframe-frame-wrapper--streaming' : ''}`}>
      {view.streamingActive && <div className="iframe-shimmer-bar" />}
      {view.isResizing && <div className="iframe-pointer-shield" aria-hidden="true" />}
      <IframeOverviewBadge mode={view.renderMode} url={view.url} title={view.title} faviconUrl={view.faviconUrl} />
      {view.renderMode === 'url' ? (
        <>
          <div ref={refs.webviewHostRef} key={view.webviewKey} className="iframe-frame-host" />
          {view.loadState === 'queued' && !view.webviewDiscarded && (
            <div className="iframe-load-queued" role="status">
              {view.faviconUrl ? <img src={view.faviconUrl} alt="" /> : null}
              <strong>{view.title || t('node.type.webPage')}</strong>
              <span>{t('linkDrawer.waitingToLoad')}</span>
            </div>
          )}
          {view.webviewDiscarded && (
            <div
              className="iframe-discarded"
              role="button"
              tabIndex={0}
              title="Sleeping to save memory — click to wake"
              onClick={actions.wakeWebview}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') actions.wakeWebview();
              }}
            >
              {view.discardSnapshot && <img className="iframe-discarded-snapshot" src={view.discardSnapshot} alt="" />}
              <div className="iframe-discarded-chip">Sleeping — click to wake</div>
            </div>
          )}
          {view.loadState === 'failed' && (
            <div className="iframe-load-error">
              <div className="iframe-load-error-card">
                <div className="iframe-load-error-title">Can’t display this page here</div>
                <div className="iframe-load-error-message">{view.loadError ?? 'The embedded page could not be displayed.'}</div>
                <div className="iframe-load-error-note">It stays on the canvas as a reference.</div>
                <div className="iframe-load-error-actions">
                  <Button type="button" variant="primary" size="sm" onClick={actions.reload}>Reload</Button>
                  <Button type="button" variant="secondary" size="sm" onClick={actions.openExternal}>Open externally</Button>
                </div>
              </div>
            </div>
          )}
        </>
      ) : view.streamingActive ? (
        <iframe ref={refs.streamIframeRef} key="stream-shell" className="iframe-frame" srcDoc={STREAMING_SHELL} sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox" title="Generating..." />
      ) : !view.shouldMountInlineFrame ? (
        <div ref={refs.frameHostRef} className="iframe-frame iframe-frame--pending" aria-hidden="true" />
      ) : (
        <iframe
          ref={refs.renderIframeRef}
          key={view.isArtifactMode ? `artifact-${view.artifact?.currentVersionId ?? 'loading'}` : view.webviewKey}
          className="iframe-frame"
          src={view.localUrl || undefined}
          srcDoc={view.localUrl ? undefined : view.inspectableHtml}
          onLoad={view.nodeId === 'node-welcome-download' && !view.localUrl
            ? () => markOnce('welcome:local-content-ready')
            : undefined}
          sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
          title={view.isArtifactMode
            ? `Artifact: ${view.artifact?.title ?? 'loading'}`
            : view.mode === 'ai' ? 'AI-generated preview' : 'HTML preview'}
        />
      )}
    </div>
  );
};
