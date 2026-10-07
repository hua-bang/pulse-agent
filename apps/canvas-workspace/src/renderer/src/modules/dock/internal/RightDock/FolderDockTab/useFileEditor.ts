import { useCallback, useSyncExternalStore } from 'react';
import { useI18n } from '../../../../../i18n';
import type { DockStore } from '../state/dock-store';
import { isFileDirty } from '../state/dock-folder-editor';

export const useFileEditor = (store: DockStore) => {
  const { t } = useI18n();
  const scope = store.getSnapshot().activeTerminalWorkspaceId;
  const editor = store.folderEditor;
  const state = useSyncExternalStore(editor.subscribe, () => editor.get(scope));
  const save = useCallback(async (): Promise<boolean> => {
    const current = editor.get(scope);
    if (current.saving) return false;
    if (!current.draft || !isFileDirty(current)) return true;
    const draft = current.draft;
    editor.update(scope, { saving: true, error: undefined });
    try {
      const result = await window.canvasWorkspace.file.savePreview({ filePath: draft.path, content: draft.content, expectedVersion: draft.version });
      if (!result.ok) {
        editor.update(scope, { error: result.conflict ? t('folder.conflict') : result.error });
        return false;
      }
      const latest = editor.get(scope).draft;
      if (latest?.path === draft.path) editor.update(scope, { draft: { ...latest, original: draft.content, version: result.version } });
      return true;
    } catch (error) {
      editor.update(scope, { error: String(error) });
      return false;
    } finally { editor.update(scope, { saving: false }); }
  }, [editor, scope, t]);
  const guard = (action: () => void) => {
    const scopedAction = () => { if (store.getSnapshot().activeTerminalWorkspaceId === scope) action(); };
    if (editor.allow(scope, scopedAction)) scopedAction();
  };
  return { state, dirty: isFileDirty(state), save, editor, scope, guard };
};
