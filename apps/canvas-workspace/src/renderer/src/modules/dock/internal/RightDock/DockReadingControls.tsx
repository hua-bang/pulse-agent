import { ArrowsOutSimple, ArrowsInSimple } from '@phosphor-icons/react';
import { Button } from '../../../../components/ui';
import { SplitViewToggle } from './SplitViewToggle';
import { useI18n } from '../../../../i18n';
import type { DockStore } from './dock-store';
import { DockTabSwitcher } from './DockTabSwitcher';
import { getDockTabSwitcherItems } from './dock-tab-items';
import { getDockPaneSelection } from '../../../../shared/dock/dock-split-state';
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
  const state = store.getSnapshot();
  const pair = state.splitTabIds;
  const candidates = getDockTabSwitcherItems(state, {
    chatTabEnabled, chatTitle: t('rightDock.chat'), terminalTitle: t('workspaceTerminal.title'),
  }).filter(item => getDockPaneSelection(state, item.id, 'right'));

  if (!hasContent) return null;
  const readingLabel = expanded ? returnLabel : t('rightDock.expandReading');
  return (
    <>
      <Button variant="icon" size="sm" className="right-dock__reading-toggle"
        aria-label={readingLabel} title={readingLabel} aria-pressed={expanded}
        onClick={expanded ? onReturn : onExpand}>
        {expanded ? <ArrowsInSimple size={16} /> : <ArrowsOutSimple size={16} />}
      </Button>
      {pair ? <SplitViewToggle store={store} active canOpen
        onToggle={() => { if (store.getSnapshot().splitTabIds) store.toggleSplitView(); focusActiveDockTarget(store); }} /> : (
        <DockTabSwitcher key={`${state.activeTerminalWorkspaceId}:${state.activeTabId}`}
          mode="compare" items={candidates} activeTabId={null}
          onActivate={id => { store.placeTab(id, 'right'); focusActiveDockTarget(store); }} />
      )}
    </>
  );
};
