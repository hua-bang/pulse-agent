import { useEffect } from 'react';
import { useI18n } from '../../../../../i18n';
import { useAppShell } from '../../../../../shared/appShell';
import { useDockContext } from '../context';
import type { DockStore } from '../state/dock-store';
import { DOCK_TAB_LIMIT, type DockAutoCloseNotice } from './dock-tab-cleanup';

/** Reopen the batch's web tabs, newest close first, and keep the tab the user was on. */
function restoreClosedTabs(store: DockStore, notice: DockAutoCloseNotice): void {
  if (store.getSnapshot().activeTerminalWorkspaceId !== notice.workspaceId) return;
  const activeTabId = store.getSnapshot().activeTabId;
  // Reverse close order puts each tab back at the index it was closed from.
  for (const id of [...notice.reopenableTabIds].reverse()) {
    const offset = store.getClosedTabs().findIndex((tab) => tab.id === id);
    if (offset >= 0) store.reopenClosedTab(offset);
  }
  store.activate(activeTabId);
}

/**
 * Automatic tab cleanup must not be silent: say how many tabs closed.
 * A first-visit cleanup offers to restore its web tabs. A cap close does not,
 * because a restored tab would only push another tab over the cap. Mounted
 * once inside the app shell, beside `RightDock`.
 */
export const DockAutoCloseToasts = (): null => {
  const { store } = useDockContext();
  const { t } = useI18n();
  const { notify } = useAppShell();

  useEffect(() => store.tabCleanup.subscribe((notice) => {
    if (notice.reason === 'overflow') {
      notify({ tone: 'info', title: t('rightDock.autoClose.overflow', { limit: DOCK_TAB_LIMIT, count: notice.count }) });
      return;
    }
    notify({
      tone: 'info',
      title: t('rightDock.autoClose.idle', { count: notice.count }),
      // Long enough to reach the restore button.
      autoCloseMs: notice.reopenableTabIds.length > 0 ? 6000 : undefined,
      action: notice.reopenableTabIds.length > 0
        ? { label: t('rightDock.autoClose.restore'), onClick: () => restoreClosedTabs(store, notice) }
        : undefined,
    });
  }), [notify, store, t]);
  return null;
};
