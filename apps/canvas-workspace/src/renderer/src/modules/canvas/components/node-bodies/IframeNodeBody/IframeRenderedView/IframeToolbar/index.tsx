import { Button } from '../../../../../../../components/ui';
import './index.css';
import { ExternalLinkIcon } from '../../../../../../../components/icons';
import { BrowserNavigationButtons } from '../../../../../../../components/ui/BrowserNavigationButtons';
import type { IframeRenderedViewProps } from '../types';

const SHOW_REVIEW_COMMENT_ACTION = false;

type ToolbarProps = Pick<IframeRenderedViewProps,
  | 'artifact'
  | 'artifactId'
  | 'cancel'
  | 'canGoBack'
  | 'canGoForward'
  | 'commit'
  | 'domPickerActive'
  | 'draftUrl'
  | 'generating'
  | 'handleGoBack'
  | 'handleGoForward'
  | 'handleKeyDown'
  | 'handleOpenExternal'
  | 'handlePickDomElement'
  | 'handlePickReviewElement'
  | 'handleRegenerate'
  | 'handleReload'
  | 'html'
  | 'isArtifactMode'
  | 'mode'
  | 'openArtifact'
  | 'readOnly'
  | 'reviewPickerActive'
  | 'savedPrompt'
  | 'setDraftUrl'
  | 'setEditing'
  | 'url'
  | 'workspaceId'
>;

export const IframeToolbar = (props: ToolbarProps) => (
  <div className="iframe-bar">
    <BrowserNavigationButtons
      canGoBack={props.canGoBack}
      canGoForward={props.canGoForward}
      disabled={props.generating}
      onBack={props.handleGoBack}
      onForward={props.handleGoForward}
      onReload={props.handleReload}
      showHistory={props.mode === 'url'}
    />
    <IframeAddressButton {...props} />
    <div className="iframe-bar-actions">
      {props.mode === 'ai' && !props.generating && !props.readOnly && (
        <Button type="button" variant="icon" size="xs" className="iframe-bar-btn" onClick={() => void props.handleRegenerate()} title="Regenerate" aria-label="Regenerate">
          <SparkIcon />
        </Button>
      )}
      <Button
        type="button"
        variant="icon"
        size="xs"
        className={`iframe-bar-btn${props.domPickerActive ? ' iframe-bar-btn--active' : ''}`}
        onClick={() => void props.handlePickDomElement()}
        title={props.domPickerActive ? 'Selecting DOM...' : 'Select DOM for AI Chat'}
        aria-label={props.domPickerActive ? 'Selecting DOM...' : 'Select DOM for AI Chat'}
        disabled={props.generating || props.domPickerActive || props.reviewPickerActive || !props.workspaceId}
      >
        <InspectIcon />
      </Button>
      {SHOW_REVIEW_COMMENT_ACTION && props.mode === 'url' && (
        <Button
          type="button"
          variant="icon"
          size="xs"
          className={`iframe-bar-btn${props.reviewPickerActive ? ' iframe-bar-btn--active' : ''}`}
          onClick={() => void props.handlePickReviewElement()}
          title={props.reviewPickerActive ? 'Selecting review target...' : 'Add review comment'}
          aria-label={props.reviewPickerActive ? 'Selecting review target...' : 'Add review comment'}
          disabled={props.generating || props.domPickerActive || props.reviewPickerActive || !props.workspaceId || props.readOnly}
        >
          <ReviewIcon />
        </Button>
      )}
      {props.mode === 'url' && (
        <Button type="button" variant="icon" size="xs" className="iframe-bar-btn" onClick={props.handleOpenExternal} title="Open externally" aria-label="Open externally">
          <ExternalLinkIcon />
        </Button>
      )}
    </div>
  </div>
);

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
}: ToolbarProps) => {
  if (isArtifactMode) {
    return (
      <button className="iframe-bar-url iframe-bar-url--html" onClick={() => { if (workspaceId && artifactId) openArtifact(workspaceId, artifactId); }} title={artifact?.title ?? 'Open artifact'}>
        <span className="iframe-bar-badge iframe-bar-badge--ai">Artifact</span>
        <span className="iframe-bar-url-text">{artifact?.title ?? 'Loading artifact...'}</span>
      </button>
    );
  }
  if (mode === 'url') {
    return (
      <div className={`iframe-bar-url iframe-bar-url--editable${readOnly ? ' iframe-bar-url--readonly' : ''}`} title={readOnly ? url : 'Edit URL'}>
        <input
          className="iframe-bar-url-input"
          type="url"
          value={draftUrl}
          readOnly={readOnly || generating}
          tabIndex={readOnly ? -1 : 0}
          aria-label="URL"
          spellCheck={false}
          onFocus={(event) => { if (!readOnly) event.currentTarget.select(); }}
          onChange={(event) => setDraftUrl(event.target.value)}
          onKeyDown={(event) => { handleKeyDown(event); if (event.key === 'Escape') event.currentTarget.select(); }}
          onBlur={() => {
            if (readOnly || generating) return;
            const next = draftUrl.trim();
            if (!next) cancel();
            else if (next !== url) commit();
          }}
        />
      </div>
    );
  }
  if (mode === 'ai') {
    return (
      <button className="iframe-bar-url iframe-bar-url--html" onClick={() => { if (!readOnly && !generating) setEditing(true); }} title={readOnly ? savedPrompt : generating ? 'Generating...' : 'Edit prompt'}>
        <span className="iframe-bar-badge iframe-bar-badge--ai">AI</span>
        {generating ? (
          <span className="iframe-bar-streaming"><span className="iframe-spinner iframe-spinner--small" /><span className="iframe-bar-url-text">Generating...</span></span>
        ) : <span className="iframe-bar-url-text">{savedPrompt.length > 80 ? `${savedPrompt.slice(0, 80)}...` : savedPrompt}</span>}
      </button>
    );
  }
  return (
    <button className="iframe-bar-url iframe-bar-url--html" onClick={() => { if (!readOnly) setEditing(true); }} title={readOnly ? html : 'Edit HTML'}>
      <span className="iframe-bar-badge">HTML</span>
      <span className="iframe-bar-url-text">{html.length > 80 ? `${html.slice(0, 80)}...` : html}</span>
    </button>
  );
};

const SparkIcon = () => <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M8 1.5l1.85 4.15L14 7.5l-4.15 1.85L8 13.5l-1.85-4.15L2 7.5l4.15-1.85L8 1.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /></svg>;
const InspectIcon = () => <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 2.5A.5.5 0 012.5 2h7a.5.5 0 01.5.5v7a.5.5 0 01-.5.5h-7a.5.5 0 01-.5-.5v-7zM4.2 5L3.2 6l1 1M7.8 5l1 1-1 1M5.4 8l1.2-4" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" /></svg>;
const ReviewIcon = () => <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2.5 2h7a1 1 0 011 1v4.2a1 1 0 01-1 1H6.2L3.4 10V8.2h-.9a1 1 0 01-1-1V3a1 1 0 011-1zM3.5 4.2h5M3.5 6h3.2" stroke="currentColor" strokeWidth="1.15" strokeLinecap="round" strokeLinejoin="round" /></svg>;
