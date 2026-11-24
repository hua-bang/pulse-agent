import { useCallback } from 'react';
import { useAppShell } from '../shell/AppShellProvider';
import { useI18n } from '../../i18n';
import { useWorkspaces } from '../workspaces/useWorkspaces';
import { runViewTransition } from '../../shared/viewTransition';
import { useMenuCommands } from './useMenuCommands';
import { useTeamInputAlerts } from '../../modules/agent-team';

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
    restoreDeletedWorkspace,
    setRootFolder,
    importWorkspace,
    createFolder,
    renameFolder,
    deleteFolder,
    restoreFolder,
  } = store;

  // One transition covers the workspace swap and the route change, so a tab
  // switch cross-fades like a page switch.
  const select = useCallback((id: string) => {
    runViewTransition(() => {
      ensureWorkspaceNodesLoaded(id);
      selectWorkspace(id);
      setLocation(canvasRoute);
    });
  }, [canvasRoute, ensureWorkspaceNodesLoaded, selectWorkspace, setLocation]);

  const create = useCallback((name: string, folderId?: string, presetId?: string) => {
    const displayName = name.trim() || t('app.untitledWorkspace');
    const id = createWorkspace(name, folderId, presetId);
    void window.canvasWorkspace?.telemetry?.track('workspace_created', { source: 'new' });
    notify({ tone: 'success', title: t('app.workspaceCreated'), description: displayName });
    return id;
  }, [createWorkspace, notify, t]);

  const rename = useCallback((id: string, name: string) => {
    const workspace = workspaces.find((item) => item.id === id);
    const trimmed = name.trim();
    if (!workspace || !trimmed || workspace.name === trimmed) return;
    // The new name shows in place; a success toast would only repeat it.
    renameWorkspace(id, trimmed);
  }, [workspaces, renameWorkspace]);

  // The confirm, toast, and undo flow loads on first use, outside the
  // startup bundle.
  const remove = useCallback(async (id: string) => {
    const index = workspaces.findIndex((item) => item.id === id);
    const workspace = workspaces[index];
    if (!workspace) return;
    const { confirmAndDeleteWorkspace } = await import('./workspaceDeleteFlow');
    await confirmAndDeleteWorkspace(workspace, index, {
      confirm, notify, updateToast, t, deleteWorkspace, restoreDeletedWorkspace, select, enterChatView,
    });
  }, [workspaces, confirm, notify, updateToast, deleteWorkspace, restoreDeletedWorkspace, select, enterChatView, t]);

  const exportWorkspace = useCallback(async (id: string) => {
    const actions = await import('./workspaceArchiveActions');
    return actions.exportWorkspace(id, workspaces, { notify, updateToast, t });
  }, [workspaces, notify, updateToast, t]);

  const importWorkspaceWithFeedback = useCallback(async () => {
    const actions = await import('./workspaceArchiveActions');
    return actions.importWorkspace({ importWorkspace, notify, updateToast, t, setLocation, canvasRoute });
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
  }, [folders, renameFolder]);

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
    // Delete only edits the manifest, so Undo restores the same snapshot.
    const index = folders.indexOf(folder);
    const memberIds = workspaces.filter((w) => w.folderId === id).map((w) => w.id);
    deleteFolder(id);
    notify({
      tone: 'success',
      title: t('app.folderDeleted'),
      description: t('app.folderDeletedDescription', { name: folder.name }),
      autoCloseMs: 8000,
      action: {
        label: t('app.undoDelete'),
        onClick: () => restoreFolder(folder, index, memberIds),
      },
    });
  }, [folders, workspaces, confirm, deleteFolder, restoreFolder, notify, t]);

  // The native menu's New workspace runs the same create-and-open as the tab bar.
  useMenuCommands({ createWorkspace: () => select(create('')) });

  // A team question reaches the user from any route; the action opens its canvas.
  useTeamInputAlerts({
    notify,
    openWorkspace: select,
    labels: {
      title: (teamName) => t('agentTeam.needsInputTitle', { team: teamName }),
      open: t('agentTeam.openTeam'),
    },
  });

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
