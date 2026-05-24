import type { MouseEvent } from 'react';

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
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path
        d="M3.2 2.2c0-.55.45-1 1-1h3.6c.55 0 1 .45 1 1v8.1L6 8.65 3.2 10.3V2.2z"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinejoin="round"
      />
      <path d="M4.8 3.6h2.4" stroke="currentColor" strokeWidth="1.15" strokeLinecap="round" />
    </svg>
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
