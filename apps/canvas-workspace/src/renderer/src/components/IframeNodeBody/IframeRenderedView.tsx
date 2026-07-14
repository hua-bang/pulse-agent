import { useEffect, useMemo, type KeyboardEventHandler, type RefObject } from 'react';
import type { Artifact } from '../../types';
import { Button } from '../ui/Button';
import { BrowserNavigationButtons } from '../EmbeddedBrowser/BrowserNavigationButtons';
import { STREAMING_SHELL } from '../artifacts/streamingShell';
import { appendDomPickerBridge } from './domPickerBridge';
import { IframeOverviewBadge } from './IframeOverviewBadge';
import type { LoadState } from './types';
import { markOnce } from '../../perf/monitor';

interface IframeRenderedViewProps {
  artifact: Artifact | null;
  artifactHtml: string;
  artifactId: string | null;
  cancel: () => void;
  canGoBack: boolean;
  canGoForward: boolean;
  commit: () => void;
  discardSnapshot: string | null;
  draftUrl: string;
  faviconUrl?: string;
  frameHostRef: RefObject<HTMLDivElement>;
  generating: boolean;
  handleOpenExternal: () => void;
  handleKeyDown: KeyboardEventHandler<HTMLInputElement>;
  handleGoBack: () => void;
  handleGoForward: () => void;
  handlePickDomElement: () => Promise<void> | void;
  handlePickReviewElement: () => Promise<void> | void;
  handleRegenerate: () => Promise<void> | void;
  handleReload: () => void;
  html: string;
  isArtifactMode: boolean;
  isResizing?: boolean;
  loadError: string | null;
  loadState: LoadState;
  localUrl: string;
  mode: string;
  nodeId: string;
  openArtifact: (workspaceId: string, artifactId: string) => void;
  domPickerActive: boolean;
  reviewPickerActive: boolean;
  readOnly: boolean;
  savedPrompt: string;
  setDraftUrl: (value: string) => void;
  setEditing: (editing: boolean) => void;
  onWakeWebview: () => void;
  renderIframeRef: RefObject<HTMLIFrameElement>;
  shouldMountInlineFrame: boolean;
  streamIframeRef: RefObject<HTMLIFrameElement>;
  streamingActive: boolean;
  webviewDiscarded: boolean;
  url: string;
  webviewHostRef: RefObject<HTMLDivElement>;
  webviewKey: number;
  workspaceId?: string;
}

export const IframeRenderedView = ({
  artifact,
  artifactHtml,
  artifactId,
  cancel,
  canGoBack,
  canGoForward,
  commit,
  discardSnapshot,
  draftUrl,
  faviconUrl,
  frameHostRef,
  generating,
  handleOpenExternal,
  handleKeyDown,
  handleGoBack,
  handleGoForward,
  handlePickDomElement,
  handlePickReviewElement,
  handleRegenerate,
  handleReload,
  html,
  isArtifactMode,
  isResizing,
  loadError,
  loadState,
  localUrl,
  mode,
  nodeId,
  openArtifact,
  domPickerActive,
  reviewPickerActive,
  readOnly,
  savedPrompt,
  setDraftUrl,
  setEditing,
  onWakeWebview,
  renderIframeRef,
  shouldMountInlineFrame,
  streamIframeRef,
  streamingActive,
  webviewDiscarded,
  url,
  webviewHostRef,
  webviewKey,
  workspaceId,
}: IframeRenderedViewProps) => {
  const renderMode = mode === 'url' ? 'url' : 'html';
  const renderedHtml = isArtifactMode ? artifactHtml : html;
  const inspectableHtml = useMemo(
    () => renderMode === 'html' ? appendDomPickerBridge(renderedHtml) : renderedHtml,
    [renderMode, renderedHtml],
  );

  useEffect(() => {
    if (nodeId !== 'node-welcome-download' || !localUrl) return;
    const handleMessage = (event: MessageEvent) => {
      if (event.source !== renderIframeRef.current?.contentWindow) return;
      if (event.data?.type === 'pulse-canvas-welcome-content-ready') {
        markOnce('welcome:local-content-ready');
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [localUrl, nodeId, renderIframeRef]);

  return (
    <div className="iframe-body">
      <div className="iframe-bar">
        <BrowserNavigationButtons
          canGoBack={canGoBack}
          canGoForward={canGoForward}
          disabled={generating}
          onBack={handleGoBack}
          onForward={handleGoForward}
          onReload={handleReload}
          showHistory={mode === 'url'}
        />

        <IframeAddressButton
          artifact={artifact}
          artifactId={artifactId}
          cancel={cancel}
          commit={commit}
          draftUrl={draftUrl}
          generating={generating}
          handleKeyDown={handleKeyDown}
          html={html}
          isArtifactMode={isArtifactMode}
          mode={mode}
          openArtifact={openArtifact}
          readOnly={readOnly}
          savedPrompt={savedPrompt}
          setDraftUrl={setDraftUrl}
          setEditing={setEditing}
          url={url}
          workspaceId={workspaceId}
        />

        <div className="iframe-bar-actions">
          {mode === 'ai' && !generating && !readOnly && (
            <Button
              type="button"
              variant="icon"
              size="xs"
              className="iframe-bar-btn"
              onClick={() => void handleRegenerate()}
              title="Regenerate"
              aria-label="Regenerate"
            >
              <SparkIcon />
            </Button>
          )}

          <Button
            type="button"
            variant="icon"
            size="xs"
            className={`iframe-bar-btn${domPickerActive ? ' iframe-bar-btn--active' : ''}`}
            onClick={() => void handlePickDomElement()}
            title={domPickerActive ? 'Selecting DOM...' : 'Select DOM for AI Chat'}
            aria-label={domPickerActive ? 'Selecting DOM...' : 'Select DOM for AI Chat'}
            disabled={generating || domPickerActive || reviewPickerActive || !workspaceId}
          >
            <InspectIcon />
          </Button>

          {mode === 'url' && (
            <Button
              type="button"
              variant="icon"
              size="xs"
              className={`iframe-bar-btn${reviewPickerActive ? ' iframe-bar-btn--active' : ''}`}
              onClick={() => void handlePickReviewElement()}
              title={reviewPickerActive ? 'Selecting review target...' : 'Add review comment'}
              aria-label={reviewPickerActive ? 'Selecting review target...' : 'Add review comment'}
              disabled={generating || domPickerActive || reviewPickerActive || !workspaceId || readOnly}
            >
              <ReviewIcon />
            </Button>
          )}

          {mode === 'url' && (
            <Button
              type="button"
              variant="icon"
              size="xs"
              className="iframe-bar-btn"
              onClick={handleOpenExternal}
              title="Open externally"
              aria-label="Open externally"
            >
              <OpenIcon />
            </Button>
          )}
        </div>
      </div>

      <div className={`iframe-frame-wrapper${streamingActive ? ' iframe-frame-wrapper--streaming' : ''}`}>
        {streamingActive && <div className="iframe-shimmer-bar" />}
        {isResizing && <div className="iframe-pointer-shield" aria-hidden="true" />}
        <IframeOverviewBadge mode={renderMode} url={url} faviconUrl={faviconUrl} />
        {renderMode === 'url' ? (
          <>
            <div
              ref={webviewHostRef}
              key={webviewKey}
              className="iframe-frame-host"
            />
            {webviewDiscarded && (
              // L3 discard placeholder (Memory Saver style): the guest
              // process was reclaimed for memory; the last-frame snapshot
              // (or a plain card when capture failed) stands in. Click or
              // linger in the viewport to wake — the page reloads.
              <div
                className="iframe-discarded"
                role="button"
                tabIndex={0}
                title="Sleeping to save memory — click to wake"
                onClick={onWakeWebview}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onWakeWebview(); }}
              >
                {discardSnapshot ? (
                  <img className="iframe-discarded-snapshot" src={discardSnapshot} alt="" />
                ) : null}
                <div className="iframe-discarded-chip">Sleeping — click to wake</div>
              </div>
            )}
            {loadState === 'failed' && (
              <div className="iframe-load-error">
                <div className="iframe-load-error-card">
                  <div className="iframe-load-error-title">Can’t display this page here</div>
                  <div className="iframe-load-error-message">
                    {loadError ?? 'The embedded page could not be displayed.'}
                  </div>
                  <div className="iframe-load-error-note">
                    It stays on the canvas as a reference.
                  </div>
                  <div className="iframe-load-error-actions">
                    <Button type="button" variant="primary" size="sm" onClick={handleReload}>
                      Reload
                    </Button>
                    <Button type="button" variant="secondary" size="sm" onClick={handleOpenExternal}>
                      Open externally
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </>
        ) : streamingActive ? (
          <iframe
            ref={streamIframeRef}
            key="stream-shell"
            className="iframe-frame"
            srcDoc={STREAMING_SHELL}
            sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
            title="Generating..."
          />
        ) : !shouldMountInlineFrame ? (
          // Deferred mount: the subdocument is only created once the node is
          // near the viewport (useDeferredVisibleMount) — off-screen inline
          // iframes doubled the large-canvas mount cost. The observer
          // deliberately watches THIS pending shell, not the wrapper: at
          // overview zoom the shell is display:none (semantic-zoom CSS), so
          // an overview visit doesn't mass-mount 40 hidden subdocuments —
          // measured as a mount burst bleeding into the next gesture.
          <div
            ref={frameHostRef}
            className="iframe-frame iframe-frame--pending"
            aria-hidden="true"
          />
        ) : (
          <iframe
            ref={renderIframeRef}
            key={isArtifactMode ? `artifact-${artifact?.currentVersionId ?? 'loading'}` : webviewKey}
            className="iframe-frame"
            src={localUrl || undefined}
            srcDoc={localUrl ? undefined : inspectableHtml}
            onLoad={nodeId === 'node-welcome-download' && !localUrl
              ? () => markOnce('welcome:local-content-ready')
              : undefined}
            sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
            title={
              isArtifactMode
                ? `Artifact: ${artifact?.title ?? 'loading'}`
                : mode === 'ai' ? 'AI-generated preview' : 'HTML preview'
            }
          />
        )}
      </div>
    </div>
  );
};

const IframeAddressButton = ({
  artifact,
  artifactId,
  cancel,
  commit,
  draftUrl,
  generating,
  handleKeyDown,
  html,
  isArtifactMode,
  mode,
  openArtifact,
  readOnly,
  savedPrompt,
  setDraftUrl,
  setEditing,
  url,
  workspaceId,
}: Pick<IframeRenderedViewProps,
  | 'artifact'
  | 'artifactId'
  | 'cancel'
  | 'commit'
  | 'draftUrl'
  | 'generating'
  | 'handleKeyDown'
  | 'html'
  | 'isArtifactMode'
  | 'mode'
  | 'openArtifact'
  | 'readOnly'
  | 'savedPrompt'
  | 'setDraftUrl'
  | 'setEditing'
  | 'url'
  | 'workspaceId'
>) => {
  if (isArtifactMode) {
    return (
      <button
        className="iframe-bar-url iframe-bar-url--html"
        onClick={() => {
          if (workspaceId && artifactId) openArtifact(workspaceId, artifactId);
        }}
        title={artifact?.title ?? 'Open artifact'}
      >
        <span className="iframe-bar-badge iframe-bar-badge--ai">Artifact</span>
        <span className="iframe-bar-url-text">
          {artifact?.title ?? 'Loading artifact...'}
        </span>
      </button>
    );
  }

  if (mode === 'url') {
    return (
      <div
        className={`iframe-bar-url iframe-bar-url--editable${readOnly ? ' iframe-bar-url--readonly' : ''}`}
        title={readOnly ? url : 'Edit URL'}
      >
        <input
          className="iframe-bar-url-input"
          type="url"
          value={draftUrl}
          readOnly={readOnly || generating}
          tabIndex={readOnly ? -1 : 0}
          aria-label="URL"
          spellCheck={false}
          onFocus={(event) => {
            if (!readOnly) event.currentTarget.select();
          }}
          onChange={(event) => setDraftUrl(event.target.value)}
          onKeyDown={(event) => {
            handleKeyDown(event);
            if (event.key === 'Escape') event.currentTarget.select();
          }}
          onBlur={() => {
            if (readOnly || generating) return;
            const next = draftUrl.trim();
            if (!next) {
              cancel();
              return;
            }
            if (next !== url) commit();
          }}
        />
      </div>
    );
  }

  if (mode === 'ai') {
    return (
      <button
        className="iframe-bar-url iframe-bar-url--html"
        onClick={() => {
          if (!readOnly && !generating) setEditing(true);
        }}
        title={readOnly ? savedPrompt : generating ? 'Generating...' : 'Edit prompt'}
      >
        <span className="iframe-bar-badge iframe-bar-badge--ai">AI</span>
        {generating ? (
          <span className="iframe-bar-streaming">
            <span className="iframe-spinner iframe-spinner--small" />
            <span className="iframe-bar-url-text">Generating...</span>
          </span>
        ) : (
          <span className="iframe-bar-url-text">
            {savedPrompt.length > 80 ? `${savedPrompt.slice(0, 80)}...` : savedPrompt}
          </span>
        )}
      </button>
    );
  }

  return (
    <button
      className="iframe-bar-url iframe-bar-url--html"
      onClick={() => {
        if (!readOnly) setEditing(true);
      }}
      title={readOnly ? html : 'Edit HTML'}
    >
      <span className="iframe-bar-badge">HTML</span>
      <span className="iframe-bar-url-text">
        {html.length > 80 ? `${html.slice(0, 80)}...` : html}
      </span>
    </button>
  );
};

const SparkIcon = () => (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
    <path d="M8 1.5l1.85 4.15L14 7.5l-4.15 1.85L8 13.5l-1.85-4.15L2 7.5l4.15-1.85L8 1.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
  </svg>
);

const InspectIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
    <path
      d="M2 2.5A.5.5 0 012.5 2h7a.5.5 0 01.5.5v7a.5.5 0 01-.5.5h-7a.5.5 0 01-.5-.5v-7zM4.2 5L3.2 6l1 1M7.8 5l1 1-1 1M5.4 8l1.2-4"
      stroke="currentColor"
      strokeWidth="1.1"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const ReviewIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
    <path
      d="M2.5 2h7a1 1 0 011 1v4.2a1 1 0 01-1 1H6.2L3.4 10V8.2h-.9a1 1 0 01-1-1V3a1 1 0 011-1zM3.5 4.2h5M3.5 6h3.2"
      stroke="currentColor"
      strokeWidth="1.15"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const OpenIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
    <path
      d="M5 2H2.5A.5.5 0 002 2.5v7A.5.5 0 002.5 10h7a.5.5 0 00.5-.5V7M7 2h3v3M5.5 6.5L10 2"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
