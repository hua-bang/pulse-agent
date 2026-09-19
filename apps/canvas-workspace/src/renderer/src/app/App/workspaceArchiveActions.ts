import type { useI18n } from '../../i18n';
import type { AppShellPort } from '../../shared/appShell';
import type { WorkspaceEntry, WorkspaceImportResult } from '../../shared/workspaces';

interface Feedback extends Pick<AppShellPort, 'notify' | 'updateToast'> {
  t: ReturnType<typeof useI18n>['t'];
}

/** Archive feedback is only needed after an explicit import/export action. */
export async function exportWorkspace(id: string, workspaces: WorkspaceEntry[], feedback: Feedback): Promise<void> {
  const { notify, updateToast, t } = feedback;
  const workspace = workspaces.find((item) => item.id === id);
  const api = window.canvasWorkspace?.store;
  if (!workspace || !api) return;
  const toastId = notify({
    tone: 'loading',
    title: t('app.exportingWorkspaceTitle', { name: workspace.name }),
    description: t('app.exportingWorkspaceDescription'),
  });
  const result = await api.exportWorkspace(workspace.id, workspace.name);
  if (!result.ok) {
    updateToast(toastId, result.canceled ? {
      tone: 'info',
      title: t('app.exportCanceled'),
      description: workspace.name,
      autoCloseMs: 1800,
    } : {
      tone: 'error',
      title: t('app.workspaceExportFailed'),
      description: result.error ?? t('app.workspaceExportFailedDescription'),
      autoCloseMs: 4200,
    });
    return;
  }
  updateToast(toastId, {
    tone: 'success',
    title: t('app.workspaceExported'),
    description: result.filePath ?? `${workspace.name} (${result.fileCount ?? 0} files)`,
    autoCloseMs: 3600,
  });
}

export async function importWorkspace(context: Feedback & {
  importWorkspace: () => Promise<WorkspaceImportResult>;
  setLocation: (path: string) => void;
  canvasRoute: string;
}): Promise<void> {
  const { importWorkspace, notify, updateToast, t, setLocation, canvasRoute } = context;
  const toastId = notify({
    tone: 'loading',
    title: t('app.importingWorkspaceTitle'),
    description: t('app.importingWorkspaceDescription'),
  });
  const result = await importWorkspace();
  if (!result.ok) {
    updateToast(toastId, result.canceled ? {
      tone: 'info',
      title: t('app.importCanceled'),
      description: t('app.importCanceledDescription'),
      autoCloseMs: 1800,
    } : {
      tone: 'error',
      title: t('app.workspaceImportFailed'),
      description: result.error ?? t('app.workspaceImportFailedDescription'),
      autoCloseMs: 4200,
    });
    return;
  }
  updateToast(toastId, {
    tone: 'success',
    title: t('app.workspaceImported'),
    description: `${result.workspace?.name ?? t('app.importedWorkspaceFallback')} (${result.fileCount ?? 0} files)`,
    autoCloseMs: 3000,
  });
  setLocation(canvasRoute);
}
