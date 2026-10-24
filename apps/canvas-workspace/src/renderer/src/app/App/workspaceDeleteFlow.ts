import type { useI18n } from '../../i18n';
import type { AppShellPort } from '../../shared/appShell';
import type { WorkspaceDeleteResult, WorkspaceEntry } from '../../shared/workspaces';

interface DeleteFlowDeps extends Pick<AppShellPort, 'confirm' | 'notify' | 'updateToast'> {
  t: ReturnType<typeof useI18n>['t'];
  deleteWorkspace: (id: string) => Promise<WorkspaceDeleteResult>;
  restoreDeletedWorkspace: (id: string) => Promise<{ ok: boolean; error?: string }>;
  select: (id: string) => void;
  enterChatView: () => void;
}

/**
 * Confirm, delete, and offer Undo in the success toast. Delete only moves
 * the workspace to trash, so Undo restores it and, when the delete had
 * switched away from it, switches back.
 */
export async function confirmAndDeleteWorkspace(workspace: WorkspaceEntry, deps: DeleteFlowDeps): Promise<void> {
  const {
    confirm, notify, updateToast, t, deleteWorkspace, restoreDeletedWorkspace, select, enterChatView,
  } = deps;
  const accepted = await confirm({
    intent: 'danger',
    title: t('app.deleteWorkspaceTitle', { name: workspace.name }),
    description: t('app.deleteWorkspaceDescription'),
    confirmLabel: t('app.deleteWorkspaceConfirm'),
  });
  if (!accepted) return;
  const toastId = notify({
    tone: 'loading',
    title: t('app.deletingWorkspaceTitle', { name: workspace.name }),
    description: t('app.deletingWorkspaceDescription'),
  });
  const result = await deleteWorkspace(workspace.id);
  if (!result.ok) {
    updateToast(toastId, {
      tone: 'error',
      title: t('app.workspaceDeletionFailed'),
      description: result.error ?? t('app.workspaceDeletionFailedDescription'),
      autoCloseMs: 4200,
    });
    return;
  }
  const undo = async () => {
    const restored = await restoreDeletedWorkspace(workspace.id);
    if (!restored.ok) {
      notify({ tone: 'error', title: t('app.workspaceRestoreFailed'), description: restored.error });
      return;
    }
    if (result.switchedActive) select(workspace.id);
    notify({ tone: 'success', title: t('app.workspaceRestored'), description: workspace.name });
  };
  updateToast(toastId, {
    tone: 'success',
    title: t('app.workspaceDeleted'),
    description: workspace.name,
    autoCloseMs: 8000,
    action: { label: t('app.undoDelete'), onClick: () => { void undo(); } },
  });
  if (result.switchedToEmpty) enterChatView();
}
