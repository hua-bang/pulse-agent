import { FolderSimple, Globe } from '@phosphor-icons/react';
import type { WorkspaceEntry } from '../../../hooks/useWorkspaces';
import { useI18n } from '../../../i18n';
import { Select } from '../../ui';
import type { LibraryContext } from './types';

const GLOBAL_LIBRARY_VALUE = '__global_library__';

interface Props {
  value: LibraryContext;
  workspaces: WorkspaceEntry[];
  onChange: (value: LibraryContext) => void;
}

export const LibraryContextSelect = ({ value, workspaces, onChange }: Props) => {
  const { t } = useI18n();
  const selectValue = value.kind === 'global' ? GLOBAL_LIBRARY_VALUE : value.workspaceId;

  return (
    <Select
      value={selectValue}
      ariaLabel={t('skillsLibrary.libraryContext')}
      className="skills-library__workspace-select"
      options={[
        {
          value: GLOBAL_LIBRARY_VALUE,
          label: t('skillsLibrary.globalLibrary'),
          description: t('skillsLibrary.availableEverywhere'),
          icon: <Globe size={15} />,
        },
        ...workspaces.map((workspace) => ({
          value: workspace.id,
          label: workspace.name,
          description: t('skillsLibrary.workspaceLibrary'),
          icon: <FolderSimple size={15} />,
        })),
      ]}
      onChange={(nextValue) => onChange(
        nextValue === GLOBAL_LIBRARY_VALUE
          ? { kind: 'global' }
          : { kind: 'workspace', workspaceId: nextValue },
      )}
    />
  );
};
