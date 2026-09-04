import { useCallback } from 'react';
import { useAppShell } from '../shell/AppShellProvider';
import { useI18n } from '../../i18n';
import { useWorkspaces } from '../workspaces/useWorkspaces';

interface Options {
  store: ReturnType<typeof useWorkspaces>;
  ensureWorkspaceNodesLoaded: (workspaceId: string) => void;
  enterChatView: () => void;
  setLocation: (path: string) => void;
  canvasRoute: string;
}

export const useWorkspaceActions = ({
  store,
  ensureWorkspaceNodesLoaded,
  enterChatView,
  setLocation,
  canvasRoute,
}: Options) => {
  const { t } = useI18n();
  const { notify, updateToast, confirm } = useAppShell();
  const {
    workspaces,
    folders,
    activeId,
    selectWorkspace,
    createWorkspace,
    renameWorkspace,
    deleteWorkspace,
    setRootFolder,
    importWorkspace,
    createFolder,
    renameFolder,
    deleteFolder,
  } = store;

  const select = useCallback((id: string) => {
    ensureWorkspaceNodesLoaded(id);
    selectWorkspace(id);
    setLocation(canvasRoute);
  }, [canvasRoute, ensureWorkspaceNodesLoaded, selectWorkspace, setLocation]);

  const create = useCallback((name: string, folderId?: string) => {
    const displayName = name.trim() || t('app.untitledWorkspace');
    const id = createWorkspace(name, folderId);
    notify({ tone: 'success', title: t('app.workspaceCreated'), description: displayName });
    return id;
  }, [createWorkspace, notify, t]);

  const rename = useCallback((id: string, name: string) => {
    const workspace = workspaces.find((item) => item.id === id);
    const trimmed = name.trim();
    if (!workspace || !trimmed || workspace.name === trimmed) return;
    renameWorkspace(id, trimmed);
    notify({
      tone: 'success',
      title: t('app.workspaceRenamed'),
      description: `${workspace.name} -> ${trimmed}`,
    });
  }, [workspaces, renameWorkspace, notify, t]);

  const remove = useCallback(async (id: string) => {
    const workspace = workspaces.find((item) => item.id === id);
    if (!workspace) return;
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
    const result = await deleteWorkspace(id);
    if (!result.ok) {
      updateToast(toastId, {
        tone: 'error',
        title: t('app.workspaceDeletionFailed'),
        description: result.error ?? t('app.workspaceDeletionFailedDescription'),
        autoCloseMs: 4200,
      });
      return;
    }
    updateToast(toastId, {
      tone: 'success',
      title: t('app.workspaceDeleted'),
      description: workspace.name,
      autoCloseMs: 2400,
    });
    if (result.switchedToEmpty) enterChatView();
  }, [workspaces, confirm, notify, updateToast, deleteWorkspace, enterChatView, t]);

  const exportWorkspace = useCallback(async (id: string) => {
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
  }, [workspaces, notify, updateToast, t]);

  const importWorkspaceWithFeedback = useCallback(async () => {
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
  }, [canvasRoute, importWorkspace, notify, setLocation, updateToast, t]);

  const setActiveRootFolder = useCallback(async () => {
    const api = window.canvasWorkspace?.dialog;
    if (!api) {
      notify({ tone: 'error', title: t('app.rootFolderPickerUnavailable'), autoCloseMs: 3200 });
      return;
    }
    const result = await api.openFolder();
    if (!result.ok || result.canceled || !result.folderPath) return;
    setRootFolder(activeId, result.folderPath);
    notify({
      tone: 'success',
      title: t('app.rootFolderSet'),
      description: result.folderPath,
      autoCloseMs: 3000,
    });
  }, [activeId, notify, setRootFolder, t]);

  const createFolderWithFeedback = useCallback((name: string) => {
    const displayName = name.trim() || t('app.untitledFolder');
    const id = createFolder(name);
    notify({ tone: 'success', title: t('app.folderCreated'), description: displayName });
    return id;
  }, [createFolder, notify, t]);

  const renameFolderWithFeedback = useCallback((id: string, name: string) => {
    const folder = folders.find((item) => item.id === id);
    const trimmed = name.trim();
    if (!folder || !trimmed || folder.name === trimmed) return;
    renameFolder(id, trimmed);
    notify({
      tone: 'success',
      title: t('app.folderRenamed'),
      description: `${folder.name} -> ${trimmed}`,
    });
  }, [folders, renameFolder, notify, t]);

  const removeFolder = useCallback(async (id: string) => {
    const folder = folders.find((item) => item.id === id);
    if (!folder) return;
    const accepted = await confirm({
      intent: 'danger',
      title: t('app.deleteFolderTitle', { name: folder.name }),
      description: t('app.deleteFolderDescription'),
      confirmLabel: t('app.deleteFolderConfirm'),
    });
    if (!accepted) return;
    deleteFolder(id);
    notify({
      tone: 'success',
      title: t('app.folderDeleted'),
      description: t('app.folderDeletedDescription', { name: folder.name }),
    });
  }, [folders, confirm, deleteFolder, notify, t]);

  return {
    select,
    create,
    rename,
    remove,
    exportWorkspace,
    importWorkspace: importWorkspaceWithFeedback,
    setActiveRootFolder,
    createFolder: createFolderWithFeedback,
    renameFolder: renameFolderWithFeedback,
    removeFolder,
  };
};
