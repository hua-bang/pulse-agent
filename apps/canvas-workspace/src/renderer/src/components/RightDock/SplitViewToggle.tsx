import { useI18n } from '../../i18n';
import { Button } from '../ui';
import type { DockStore } from './dock-store';

interface Props {
  store: DockStore;
  active: boolean;
  canOpen: boolean;
}

const SplitViewIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <rect x="2" y="3" width="12" height="10" rx="2" stroke="currentColor" strokeWidth="1.25" />
    <path d="M8 3v10" stroke="currentColor" strokeWidth="1.25" />
  </svg>
);

export const SplitViewToggle = ({ store, active, canOpen }: Props) => {
  const { t } = useI18n();
  const label = t(active ? 'rightDock.exitSplitView' : 'rightDock.openSplitView');
  return (
    <Button
      variant="icon"
      size="sm"
      className="right-dock__split-toggle"
      aria-label={label}
      title={t('rightDock.splitView')}
      aria-pressed={active}
      disabled={!active && !canOpen}
      onClick={() => store.toggleSplitView()}
    >
      <SplitViewIcon />
    </Button>
  );
};
