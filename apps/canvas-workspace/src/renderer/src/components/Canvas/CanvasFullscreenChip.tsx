import { AppLogoIcon } from '../icons';
import { useI18n } from '../../i18n';

interface Props {
  /** Reference-drawer state used to flag the button as active. The
   *  chip only renders when a node is fullscreen, so these props are
   *  treated as the single control surface for fullscreen mode. */
  referenceDrawerOpen?: boolean;
  onReferenceToggle?: () => void;
  chatPanelOpen?: boolean;
  onChatOpen?: () => void;
  onExitFullscreen: () => void;
}

/**
 * Fullscreen-only chip. Becomes the single control surface for
 * fullscreen mode — Reference / Chat toggles plus the exit button — so
 * the user has one stable spot to reach all the relevant actions and
 * we don't have to fight the node header for top-right real estate.
 * The node's own fullscreen toggle is hidden while this is shown (see
 * CanvasNodeView CSS).
 */
export const CanvasFullscreenChip = ({
  referenceDrawerOpen,
  onReferenceToggle,
  chatPanelOpen,
  onChatOpen,
  onExitFullscreen,
}: Props) => {
  const { t } = useI18n();

  return (
    <div
      className="canvas-fullscreen-chip"
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      {onReferenceToggle && (
        <button
          className={`canvas-fullscreen-chip__btn${referenceDrawerOpen ? ' canvas-fullscreen-chip__btn--active' : ''}`}
          type="button"
          onClick={onReferenceToggle}
          title={t('canvas.toolbar.toggleReference')}
          aria-label={t('canvas.toolbar.toggleReference')}
        >
          <svg width="16" height="16" viewBox="0 0 18 18" fill="none" aria-hidden="true">
            <rect x="3" y="3" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.3" />
            <path d="M6 6h6M6 9h4M6 12h5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </button>
      )}
      {onChatOpen && (
        <button
          className={`canvas-fullscreen-chip__btn${chatPanelOpen ? ' canvas-fullscreen-chip__btn--active' : ''}`}
          type="button"
          onClick={onChatOpen}
          title={t('canvas.empty.openAiChat')}
          aria-label={t('canvas.empty.openAiChat')}
        >
          <AppLogoIcon size={16} />
        </button>
      )}
      <div className="canvas-fullscreen-chip__divider" />
      <button
        className="canvas-fullscreen-chip__btn"
        type="button"
        onClick={onExitFullscreen}
        title={t('canvas.fullscreen.exit')}
        aria-label={t('canvas.fullscreen.exit')}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M7 1v3a1 1 0 01-1 1H3M9 1v3a1 1 0 001 1h3M7 15v-3a1 1 0 00-1-1H3M9 15v-3a1 1 0 011-1h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  );
};
