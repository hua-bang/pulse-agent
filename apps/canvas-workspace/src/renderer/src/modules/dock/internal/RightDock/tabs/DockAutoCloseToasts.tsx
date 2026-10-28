import { useEffect } from 'react';
import { useI18n } from '../../../../../i18n';
import { useAppShell } from '../../../../../shared/appShell';
import { useDockContext } from '../context';
import type { DockStore } from '../state/dock-store';
import { DOCK_TAB_LIMIT, type DockAutoCloseNotice } from './dock-tab-cleanup';

/** Reopen the batch's web tabs, newest close first, and keep the tab the user was on. */
function restoreArchivedTabs(store: DockStore, notice: DockAutoCloseNotice): void {
  if (store.getSnapshot().activeTerminalWorkspaceId !== notice.workspaceId) return;
  const activeTabId = store.getSnapshot().activeTabId;
  // Reverse close order puts each tab back at the index it was closed from.
  for (const id of [...notice.archivedTabIds].reverse()) {
    const offset = store.getClosedTabs().findIndex((tab) => tab.id === id);
    if (offset >= 0) store.reopenClosedTab(offset);
  }
  store.activate(activeTabId);
}

/** Show the dock and open its tab switcher on the archive group. */
function viewArchive(store: DockStore, notice: DockAutoCloseNotice): void {
  const snapshot = store.getSnapshot();
  if (snapshot.activeTerminalWorkspaceId !== notice.workspaceId) return;
  if (!snapshot.expanded && !store.activate(snapshot.activeTabId)) store.openChat();
  store.archive.requestReveal();
}

/**
 * Automatic tab cleanup must not be silent: say how many tabs went to the
 * archive, with a "view" button that opens it. A first-visit cleanup also
 * offers to restore its web tabs. A cap close does not, because a restored
 * tab would only push another tab over the cap. Mounted once inside the app
 * shell, beside `RightDock`.
 */
export const DockAutoCloseToasts = (): null => {
  const { store } = useDockContext();
  const { t } = useI18n();
  const { notify } = useAppShell();

  useEffect(() => store.tabCleanup.subscribe((notice) => {
    const archived = notice.archivedTabIds.length > 0;
    const view = archived ? { label: t('rightDock.autoClose.view'), onClick: () => viewArchive(store, notice) } : undefined;
    // Long enough to reach the buttons.
    const autoCloseMs = archived ? 6000 : undefined;
    if (notice.reason === 'overflow') {
      notify({
        tone: 'info',
        title: t('rightDock.autoClose.overflow', { limit: DOCK_TAB_LIMIT, count: notice.count }),
        autoCloseMs,
        action: view,
      });
      return;
    }
    notify({
      tone: 'info',
      title: t('rightDock.autoClose.idle', { count: notice.count }),
      autoCloseMs,
      action: archived
        ? { label: t('rightDock.autoClose.restore'), onClick: () => restoreArchivedTabs(store, notice) }
        : undefined,
      secondaryAction: view,
    });
  }), [notify, store, t]);
  return null;
};
