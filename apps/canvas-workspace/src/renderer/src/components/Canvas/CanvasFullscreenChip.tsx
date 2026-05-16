interface Props {
  /** Reference-drawer state used to flag the button as active. The
   *  chip only renders when a node is fullscreen, so these props are
   *  treated as the single control surface for fullscreen mode. */
  referenceDrawerOpen?: boolean;
  onReferenceToggle?: () => void;
  chatPanelOpen?: boolean;
  onChatToggle?: () => void;
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
  onChatToggle,
  onExitFullscreen,
}: Props) => (
  <div className="canvas-fullscreen-chip">
    {onReferenceToggle && (
      <button
        className={`canvas-fullscreen-chip__btn${referenceDrawerOpen ? ' canvas-fullscreen-chip__btn--active' : ''}`}
        type="button"
        onClick={onReferenceToggle}
        title="Toggle Reference Drawer"
        aria-label="Toggle Reference Drawer"
      >
        <svg width="16" height="16" viewBox="0 0 18 18" fill="none" aria-hidden="true">
          <rect x="3" y="3" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.3" />
          <path d="M6 6h6M6 9h4M6 12h5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      </button>
    )}
    {onChatToggle && (
      <button
        className={`canvas-fullscreen-chip__btn${chatPanelOpen ? ' canvas-fullscreen-chip__btn--active' : ''}`}
        type="button"
        onClick={onChatToggle}
        title="Toggle AI Chat (Cmd/Ctrl+Shift+A)"
        aria-label="Toggle AI Chat"
      >
        <svg width="16" height="16" viewBox="0 0 18 18" fill="none" aria-hidden="true">
          <circle cx="9" cy="6.5" r="3.5" stroke="currentColor" strokeWidth="1.3" />
          <path d="M4.5 16c0-2.5 2-4.5 4.5-4.5s4.5 2 4.5 4.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          <circle cx="7.5" cy="6" r="0.7" fill="currentColor" />
          <circle cx="10.5" cy="6" r="0.7" fill="currentColor" />
        </svg>
      </button>
    )}
    <div className="canvas-fullscreen-chip__divider" />
    <button
      className="canvas-fullscreen-chip__btn"
      type="button"
      onClick={onExitFullscreen}
      title="Exit fullscreen (Esc)"
      aria-label="Exit fullscreen"
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M7 1v3a1 1 0 01-1 1H3M9 1v3a1 1 0 001 1h3M7 15v-3a1 1 0 00-1-1H3M9 15v-3a1 1 0 011-1h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  </div>
);
