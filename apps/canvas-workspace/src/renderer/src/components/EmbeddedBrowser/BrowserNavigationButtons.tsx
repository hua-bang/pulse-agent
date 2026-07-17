import { useI18n } from '../../i18n';
import { SpinnerIcon } from '../icons';
import { Button } from '../ui';

interface Props {
  canGoBack: boolean;
  canGoForward: boolean;
  disabled?: boolean;
  loading?: boolean;
  onBack: () => void;
  onForward: () => void;
  onReload: () => void;
  showHistory?: boolean;
}

export const BrowserNavigationButtons = ({
  canGoBack,
  canGoForward,
  disabled = false,
  loading = false,
  onBack,
  onForward,
  onReload,
  showHistory = true,
}: Props) => {
  const { t } = useI18n();
  return (
    <>
      {showHistory && (
        <>
          <Button
            variant="icon"
            size="xs"
            onClick={onBack}
            disabled={disabled || !canGoBack}
            title={t('linkDrawer.back')}
            aria-label={t('linkDrawer.back')}
          >
            <BackIcon />
          </Button>
          <Button
            variant="icon"
            size="xs"
            onClick={onForward}
            disabled={disabled || !canGoForward}
            title={t('linkDrawer.forward')}
            aria-label={t('linkDrawer.forward')}
          >
            <ForwardIcon />
          </Button>
        </>
      )}
      <Button
        variant="icon"
        size="xs"
        onClick={onReload}
        disabled={disabled}
        title={t('linkDrawer.reload')}
        aria-label={t('linkDrawer.reload')}
      >
        {loading ? <SpinnerIcon size={12} className="browser-navigation__loading-icon" /> : <ReloadIcon />}
      </Button>
    </>
  );
};

const BackIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
    <path d="M7.5 2.5L4 6l3.5 3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const ForwardIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
    <path d="M4.5 2.5L8 6l-3.5 3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const ReloadIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
    <path d="M2 6a4 4 0 016.9-2.8L10 4M10 2v2.5H7.5M10 6a4 4 0 01-6.9 2.8L2 8M2 10V7.5h2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
