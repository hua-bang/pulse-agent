import { AppLogoIcon } from '../../../../../components/icons';
import { Button } from '../../../../../components/ui/Button';
import { useI18n } from '../../../../../i18n';

interface Props {
  /** Reference-drawer state used to flag the button as active. The
   *  chip only renders when a node is fullscreen, so these props are
   *  treated as the single control surface for fullscreen mode. */
  referenceDrawerOpen?: boolean;
  onReferenceToggle?: () => void;
  chatPanelOpen?: boolean;
  onChatOpen?: () => void;
  onPrevNode?: () => void;
  onNextNode?: () => void;
  onExitFullscreen: () => void;
}

/**
 * Fullscreen-only chip. Becomes the single control surface for
 * immersive focus / fullscreen mode — prev/next node stepping, Reference /
 * Chat toggles, plus the exit button — so the user has one stable spot to
 * reach all the relevant actions without fighting the node header.
 * The node's own fullscreen toggle is hidden while this is shown (see
 * CanvasNodeView CSS).
 */
export const CanvasFullscreenChip = ({
  referenceDrawerOpen,
  onReferenceToggle,
  chatPanelOpen,
  onChatOpen,
  onPrevNode,
  onNextNode,
  onExitFullscreen,
}: Props) => {
  const { t } = useI18n();

  return (
    <div
      className="canvas-fullscreen-chip"
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      {onPrevNode && onNextNode && (
        <>
          <Button
            variant="icon"
            size="sm"
            className="canvas-fullscreen-chip__btn"
            onClick={onPrevNode}
            title={t('canvas.fullscreen.prevNode')}
            aria-label={t('canvas.fullscreen.prevNode')}
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M10 3.5L5.5 8 10 12.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Button>
          <Button
            variant="icon"
            size="sm"
            className="canvas-fullscreen-chip__btn"
            onClick={onNextNode}
            title={t('canvas.fullscreen.nextNode')}
            aria-label={t('canvas.fullscreen.nextNode')}
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M6 3.5L10.5 8 6 12.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Button>
          <div className="canvas-fullscreen-chip__divider" />
        </>
      )}
      {onReferenceToggle && (
        <Button
          variant="icon"
          size="sm"
          className={`canvas-fullscreen-chip__btn${referenceDrawerOpen ? ' canvas-fullscreen-chip__btn--active' : ''}`}
          onClick={onReferenceToggle}
          title={t('canvas.toolbar.toggleReference')}
          aria-label={t('canvas.toolbar.toggleReference')}
        >
          <svg width="16" height="16" viewBox="0 0 18 18" fill="none" aria-hidden="true">
            <rect x="3" y="3" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.3" />
            <path d="M6 6h6M6 9h4M6 12h5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </Button>
      )}
      {onChatOpen && (
        <Button
          variant="icon"
          size="sm"
          className={`canvas-fullscreen-chip__btn${chatPanelOpen ? ' canvas-fullscreen-chip__btn--active' : ''}`}
          onClick={onChatOpen}
          title={t('canvas.empty.openAiChat')}
          aria-label={t('canvas.empty.openAiChat')}
        >
          <AppLogoIcon size={16} />
        </Button>
      )}
      <div className="canvas-fullscreen-chip__divider" />
      <Button
        variant="icon"
        size="sm"
        className="canvas-fullscreen-chip__btn"
        onClick={onExitFullscreen}
        title={t('canvas.fullscreen.exit')}
        aria-label={t('canvas.fullscreen.exit')}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M7 1v3a1 1 0 01-1 1H3M9 1v3a1 1 0 001 1h3M7 15v-3a1 1 0 00-1-1H3M9 15v-3a1 1 0 011-1h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </Button>
    </div>
  );
};
