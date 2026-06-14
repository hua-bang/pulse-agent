import type { KeyboardEventHandler, RefObject } from 'react';
import type { Artifact } from '../../types';
import { STREAMING_SHELL } from '../artifacts/streamingShell';
import type { LoadState } from './types';

interface IframeRenderedViewProps {
  artifact: Artifact | null;
  artifactHtml: string;
  artifactId: string | null;
  cancel: () => void;
  commit: () => void;
  draftUrl: string;
  generating: boolean;
  handleOpenExternal: () => void;
  handleKeyDown: KeyboardEventHandler<HTMLInputElement>;
  handleRegenerate: () => Promise<void> | void;
  handleReload: () => void;
  html: string;
  faviconUrl?: string;
  isArtifactMode: boolean;
  isResizing?: boolean;
  loadError: string | null;
  loadState: LoadState;
  mode: string;
  openArtifact: (workspaceId: string, artifactId: string) => void;
  readOnly: boolean;
  savedPrompt: string;
  setDraftUrl: (value: string) => void;
  setEditing: (editing: boolean) => void;
  streamIframeRef: RefObject<HTMLIFrameElement>;
  streamingActive: boolean;
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
  commit,
  draftUrl,
  generating,
  handleOpenExternal,
  handleKeyDown,
  handleRegenerate,
  handleReload,
  html,
  faviconUrl,
  isArtifactMode,
  isResizing,
  loadError,
  loadState,
  mode,
  openArtifact,
  readOnly,
  savedPrompt,
  setDraftUrl,
  setEditing,
  streamIframeRef,
  streamingActive,
  url,
  webviewHostRef,
  webviewKey,
  workspaceId,
}: IframeRenderedViewProps) => {
  const renderMode = mode === 'url' ? 'url' : 'html';
  const renderedHtml = isArtifactMode ? artifactHtml : html;

  return (
    <div className="iframe-body">
      <div className="iframe-bar">
        <button
          className="iframe-bar-btn"
          onClick={handleReload}
          title="Reload"
          disabled={generating}
        >
          <ReloadIcon />
        </button>

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
          faviconUrl={faviconUrl}
          workspaceId={workspaceId}
        />

        {mode === 'ai' && !generating && !readOnly && (
          <button
            className="iframe-bar-btn"
            onClick={() => void handleRegenerate()}
            title="Regenerate"
          >
            <SparkIcon />
          </button>
        )}

        {mode === 'url' && (
          <button
            className="iframe-bar-btn"
            onClick={handleOpenExternal}
            title="Open externally"
          >
            <OpenIcon />
          </button>
        )}
      </div>

      <div className={`iframe-frame-wrapper${streamingActive ? ' iframe-frame-wrapper--streaming' : ''}`}>
        {streamingActive && <div className="iframe-shimmer-bar" />}
        {isResizing && <div className="iframe-pointer-shield" aria-hidden="true" />}
        {renderMode === 'url' ? (
          <>
            <div
              ref={webviewHostRef}
              key={webviewKey}
              className="iframe-frame-host"
            />
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
                    <button type="button" className="iframe-empty-btn iframe-empty-btn--primary" onClick={handleReload}>
                      Reload
                    </button>
                    <button type="button" className="iframe-empty-btn" onClick={handleOpenExternal}>
                      Open externally
                    </button>
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
        ) : (
          <iframe
            key={isArtifactMode ? `artifact-${artifact?.currentVersionId ?? 'loading'}` : webviewKey}
            className="iframe-frame"
            srcDoc={renderedHtml}
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
  faviconUrl,
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
  | 'faviconUrl'
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
        {faviconUrl ? (
          <img
            className="iframe-bar-favicon"
            src={faviconUrl}
            alt=""
            aria-hidden="true"
            onError={(event) => {
              event.currentTarget.style.display = 'none';
            }}
          />
        ) : null}
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

const ReloadIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
    <path
      d="M2 6a4 4 0 016.9-2.8L10 4M10 2v2.5H7.5M10 6a4 4 0 01-6.9 2.8L2 8M2 10V7.5h2.5"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const SparkIcon = () => (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
    <path d="M8 1.5l1.85 4.15L14 7.5l-4.15 1.85L8 13.5l-1.85-4.15L2 7.5l4.15-1.85L8 1.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
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
