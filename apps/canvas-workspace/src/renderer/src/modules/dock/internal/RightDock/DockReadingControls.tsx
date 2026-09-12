import { ArrowsOutSimple, ArrowsInSimple } from '@phosphor-icons/react';
import { Button } from '../../../../components/ui';
import { SplitViewToggle } from './SplitViewToggle';
import { useI18n } from '../../../../i18n';
import { CHAT_TAB_ID, type DockStore } from './dock-store';
import { focusActiveDockTarget } from './dock-browser-commands';

interface Props {
  store: DockStore;
  expanded: boolean;
  chatTabEnabled: boolean;
  hasContent: boolean;
  returnLabel: string;
  onExpand: () => void;
  onReturn: () => void;
}

/** Compact controls live in the tab strip; reading never adds a toolbar row. */
export const DockReadingControls = ({ store, expanded, chatTabEnabled, hasContent,
  returnLabel, onExpand, onReturn }: Props) => {
  const { t } = useI18n();
  const pair = store.getSnapshot().splitTabIds;
  const comparing = Boolean(pair);
  if (!hasContent) return null;
  const readingLabel = expanded ? returnLabel : t('rightDock.expandReading');
  return (
    <>
      <Button variant="icon" size="sm" className="right-dock__reading-toggle"
        aria-label={readingLabel} title={readingLabel} aria-pressed={expanded}
        onClick={expanded ? onReturn : onExpand}>
        {expanded ? <ArrowsInSimple size={16} /> : <ArrowsOutSimple size={16} />}
      </Button>
      {chatTabEnabled && <SplitViewToggle store={store} active={comparing}
        canOpen={store.getSnapshot().activeTabId !== CHAT_TAB_ID}
        onToggle={() => {
          store.toggleSplitView();
          focusActiveDockTarget(store);
        }} />}
    </>
  );
};
