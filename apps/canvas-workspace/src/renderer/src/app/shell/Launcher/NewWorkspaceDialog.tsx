import { useEffect, useState, type FormEvent } from 'react';
import type { FolderEntry } from '../../../shared/workspaces';
import { Button, FieldRow, Modal, Select, TextField } from '../../../components/ui';
import { useI18n } from '../../../i18n';

/** Select value for "no folder": the workspace sits at the top of the list. */
const TOP_LEVEL = '';

interface Props {
  open: boolean;
  folders: FolderEntry[];
  onClose: () => void;
  onCreate: (name: string, folderId?: string) => void;
}

/** Names a new workspace and picks its folder before it is created. */
export const NewWorkspaceDialog = ({ open, folders, onClose, onCreate }: Props) => {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [folderId, setFolderId] = useState(TOP_LEVEL);

  useEffect(() => {
    if (!open) return;
    setName('');
    setFolderId(TOP_LEVEL);
  }, [open]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onCreate(name, folderId || undefined);
    onClose();
  };

  const locations = [
    { value: TOP_LEVEL, label: t('sidebar.workspaces') },
    ...folders.map((folder) => ({ value: folder.id, label: folder.name })),
  ];

  return (
    <Modal open={open} onClose={onClose} width={400} labelledBy="launcher-new-workspace-title">
      <form className="launcher-new-workspace" onSubmit={submit}>
        <h2 id="launcher-new-workspace-title">{t('launcher.newWorkspace')}</h2>
        <TextField
          autoFocus
          label={t('workspaceSettings.name')}
          placeholder={t('sidebar.workspaceNamePlaceholder')}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        {folders.length > 0 && (
          <FieldRow label={t('skillsLibrary.location')}>
            <Select
              value={folderId}
              options={locations}
              onChange={setFolderId}
              ariaLabel={t('skillsLibrary.location')}
            />
          </FieldRow>
        )}
        <div className="launcher-new-workspace__actions">
          <Button type="button" onClick={onClose}>{t('shell.cancel')}</Button>
          <Button type="submit" variant="primary">{t('canvas.palette.group.create')}</Button>
        </div>
      </form>
    </Modal>
  );
};
