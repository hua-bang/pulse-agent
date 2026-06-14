import type { MouseEvent } from 'react';
import { AppLogoIcon } from '../icons';

interface FullscreenButtonProps {
  floating?: boolean;
  isFullscreen: boolean;
  onClick: (e: MouseEvent) => void;
}

export const FullscreenButton = ({ floating, isFullscreen, onClick }: FullscreenButtonProps) => (
  <button
    className={`node-fullscreen${floating ? ' node-fullscreen--floating' : ''}`}
    type="button"
    onClick={onClick}
    onMouseDown={(e) => e.stopPropagation()}
    title={isFullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen'}
    aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
  >
    {isFullscreen ? (
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
        <path d="M5 1v3a1 1 0 01-1 1H1M7 1v3a1 1 0 001 1h3M5 11V8a1 1 0 00-1-1H1M7 11V8a1 1 0 011-1h3" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ) : (
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
        <path d="M1 4V1h3M11 4V1H8M1 8v3h3M11 8v3H8" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )}
  </button>
);

interface CloseButtonProps {
  floating?: boolean;
  onClick: (e: MouseEvent) => void;
}

export const CloseButton = ({ floating, onClick }: CloseButtonProps) => (
  <button
    className={`node-close${floating ? ' node-close--floating' : ''}`}
    type="button"
    onClick={onClick}
    onMouseDown={(e) => e.stopPropagation()}
    title="Remove"
  >
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  </button>
);

export const FocusButton = ({ onClick }: { onClick: (e: MouseEvent) => void }) => (
  <button
    className="node-focus"
    type="button"
    onClick={onClick}
    onMouseDown={(e) => e.stopPropagation()}
    title="Focus"
  >
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <circle cx="6" cy="6" r="2" stroke="currentColor" strokeWidth="1.3" />
      <path d="M6 1v2M6 9v2M1 6h2M9 6h2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  </button>
);

export const ReferenceButton = ({
  nodeTitle,
  onClick,
}: {
  nodeTitle: string;
  onClick: (e: MouseEvent) => void;
}) => (
  <button
    className="node-reference"
    type="button"
    onClick={onClick}
    onMouseDown={(e) => e.stopPropagation()}
    title="Reference"
    aria-label={`Pin ${nodeTitle} as reference`}
  >
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path
        d="M5.2 2.8h7.6a1.4 1.4 0 011.4 1.4v10.6L9 11.8l-5.2 3V4.2a1.4 1.4 0 011.4-1.4z"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinejoin="round"
      />
      <path
        d="M6.6 6.2h4.8M6.6 8.7h3"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  </button>
);

export const AddToChatButton = ({ onClick }: { onClick: (e: MouseEvent) => void }) => (
  <button
    className="node-add-to-chat"
    type="button"
    onClick={onClick}
    onMouseDown={(e) => e.stopPropagation()}
    title="Add to chat"
    aria-label="Add node to AI chat"
  >
    <AppLogoIcon />
  </button>
);

export const OpenSourceButton = ({
  disabled,
  onClick,
}: {
  disabled?: boolean;
  onClick: (e: MouseEvent) => void;
}) => (
  <button
    className="node-focus"
    type="button"
    onClick={onClick}
    onMouseDown={(e) => e.stopPropagation()}
    title="Open source"
    disabled={disabled}
  >
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path d="M4.5 2.5H2.8a1 1 0 00-1 1v5.7a1 1 0 001 1h5.7a1 1 0 001-1V7.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M7 1.8h3.2V5M5.6 6.4l4.3-4.3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  </button>
);
