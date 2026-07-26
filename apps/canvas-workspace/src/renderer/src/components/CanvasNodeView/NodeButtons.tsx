import type { MouseEvent } from 'react';
import { AppLogoIcon } from '../icons';
import { useI18n } from '../../i18n';

interface FullscreenButtonProps {
  floating?: boolean;
  isFullscreen: boolean;
  onClick: (e: MouseEvent) => void;
}

export const FullscreenButton = ({ floating, isFullscreen, onClick }: FullscreenButtonProps) => {
  const { t } = useI18n();
  return (
    <button
      className={`node-fullscreen${floating ? ' node-fullscreen--floating' : ''}`}
      type="button"
      onClick={onClick}
      onMouseDown={(e) => e.stopPropagation()}
      title={isFullscreen ? t('nodeButtons.exitFullscreenEsc') : t('nodeButtons.fullscreen')}
      aria-label={isFullscreen ? t('nodeButtons.exitFullscreen') : t('nodeButtons.enterFullscreen')}
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
};

export const CopyImageButton = ({ onClick }: { onClick: (e: MouseEvent) => void }) => {
  const { t } = useI18n();
  return (
    <button
      className="node-copy-image node-copy-image--floating"
      type="button"
      onClick={onClick}
      onMouseDown={(e) => e.stopPropagation()}
      title={t('nodeButtons.copyImage')}
      aria-label={t('nodeButtons.copyImage')}
    >
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
        <rect x="2" y="2" width="8" height="8" rx="1.4" stroke="currentColor" strokeWidth="1.2" />
        <path d="M3.5 8l2-2 1.5 1.5 1-1 2 2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="8" cy="4" r=".75" fill="currentColor" />
      </svg>
    </button>
  );
};

interface CloseButtonProps {
  ariaLabel?: string;
  floating?: boolean;
  onClick: (e: MouseEvent) => void;
  title?: string;
}

export const CloseButton = ({
  ariaLabel,
  floating,
  onClick,
  title,
}: CloseButtonProps) => {
  const { t } = useI18n();
  const fallback = t('nodeButtons.removeNode');
  return (
    <button
      className={`node-close${floating ? ' node-close--floating' : ''}`}
      type="button"
      onClick={onClick}
      onMouseDown={(e) => e.stopPropagation()}
      title={title ?? fallback}
      aria-label={ariaLabel ?? fallback}
    >
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
        <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    </button>
  );
};

export const FocusButton = ({
  ariaLabel,
  onClick,
  title,
}: {
  ariaLabel?: string;
  onClick: (e: MouseEvent) => void;
  title?: string;
}) => {
  const { t } = useI18n();
  const fallback = t('nodeButtons.focusNode');
  return (
    <button
      className="node-focus"
      type="button"
      onClick={onClick}
      onMouseDown={(e) => e.stopPropagation()}
      title={title ?? fallback}
      aria-label={ariaLabel ?? fallback}
    >
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
        <circle cx="6" cy="6" r="2" stroke="currentColor" strokeWidth="1.3" />
        <path d="M6 1v2M6 9v2M1 6h2M9 6h2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    </button>
  );
};

export const PluginSelectElementButton = ({
  active,
  onClick,
}: {
  active?: boolean;
  onClick: (e: MouseEvent) => void;
}) => {
  const { t } = useI18n();
  return (
    <button
      className={`node-plugin-select${active ? ' node-plugin-select--active' : ''}`}
      type="button"
      onClick={onClick}
      onMouseDown={(e) => e.stopPropagation()}
      title={active ? t('nodeButtons.cancelElementSelection') : t('nodeButtons.selectElementForChat')}
      aria-label={active ? t('nodeButtons.cancelPluginElementSelection') : t('nodeButtons.selectPluginElementForChat')}
    >
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
        <path
          d="M1.8 3.8V2.6a.8.8 0 01.8-.8h1.2M8.2 1.8h1.2a.8.8 0 01.8.8v1.2M10.2 8.2v1.2a.8.8 0 01-.8.8H8.2M3.8 10.2H2.6a.8.8 0 01-.8-.8V8.2M5 4.8l2.9 1.1-1.3.7 1.2 1.7-1 .7-1.1-1.7-1 1.1L5 4.8z"
          stroke="currentColor"
          strokeWidth="1.15"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
};

export const OpenTabButton = ({
  ariaLabel,
  nodeTitle,
  onClick,
}: {
  ariaLabel?: string;
  nodeTitle: string;
  onClick: (e: MouseEvent) => void;
}) => {
  const { t } = useI18n();
  return (
    <button
      className="node-open-tab"
      type="button"
      onClick={onClick}
      onMouseDown={(e) => e.stopPropagation()}
      title={t('nodeButtons.openInTab')}
      aria-label={ariaLabel ?? t('nodeButtons.openNodeInTab', { title: nodeTitle })}
    >
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
        <rect x="2.8" y="3.2" width="12.4" height="11.6" rx="1.5" stroke="currentColor" strokeWidth="1.35" />
        <path
          d="M3.2 6.5h11.6M5.1 4.85h3.2"
          stroke="currentColor"
          strokeWidth="1.35"
          strokeLinecap="round"
        />
      </svg>
    </button>
  );
};

/** Place this node on the main canvas as a live reference node. Offered on
 *  read-only preview nodes (the dock canvas preview). */
export const AddToCanvasButton = ({ onClick }: { onClick: (e: MouseEvent) => void }) => {
  const { t } = useI18n();
  return (
    <button
      className="node-add-to-canvas"
      type="button"
      onClick={onClick}
      onMouseDown={(e) => e.stopPropagation()}
      title={t('nodeButtons.addToMainCanvas')}
      aria-label={t('nodeButtons.addNodeAsReference')}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M8 3.25v9.5M3.25 8h9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </button>
  );
};

export const AddToChatButton = ({ onClick }: { onClick: (e: MouseEvent) => void }) => {
  const { t } = useI18n();
  return (
    <button
      className="node-add-to-chat"
      type="button"
      onClick={onClick}
      onMouseDown={(e) => e.stopPropagation()}
      title={t('nodeButtons.addToChat')}
      aria-label={t('nodeButtons.addNodeToChat')}
    >
      <AppLogoIcon />
    </button>
  );
};

export const OpenSourceButton = ({
  ariaLabel,
  className = 'node-focus',
  disabled,
  onClick,
  title,
}: {
  ariaLabel?: string;
  className?: string;
  disabled?: boolean;
  onClick: (e: MouseEvent) => void;
  title?: string;
}) => {
  const { t } = useI18n();
  const fallback = t('nodeButtons.openSource');
  return (
    <button
      className={className}
      type="button"
      onClick={onClick}
      onMouseDown={(e) => e.stopPropagation()}
      title={title ?? fallback}
      aria-label={ariaLabel ?? fallback}
      disabled={disabled}
    >
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
        <path d="M4.5 2.5H2.8a1 1 0 00-1 1v5.7a1 1 0 001 1h5.7a1 1 0 001-1V7.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        <path d="M7 1.8h3.2V5M5.6 6.4l4.3-4.3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
};

export const OpenDetailButton = ({ onClick }: { onClick: (e: MouseEvent) => void }) => {
  const { t } = useI18n();
  return (
    <OpenSourceButton
      ariaLabel={t('nodeButtons.openNoteDetailPage')}
      className="node-open-detail"
      onClick={onClick}
      title={t('nodeButtons.openDetailPage')}
    />
  );
};
