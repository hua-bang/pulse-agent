import './index.css';
import { Select, TextField } from '../../../../../components/ui';
import { useI18n } from '../../../../../i18n';
import type { WorkspaceEntry } from '../../../../../shared/workspaces';
import type { LibraryKind } from '../libraryModel';

interface Props {
  source: string; onSourceChange: (value: string) => void;
  query: string; onQueryChange: (value: string) => void;
  kind: LibraryKind; onKindChange: (value: LibraryKind) => void;
  workspaces: WorkspaceEntry[]; activeWorkspaceId: string;
}
export const ReferenceDrawerToolbar = ({ source, onSourceChange, query, onQueryChange, kind, onKindChange, workspaces, activeWorkspaceId }: Props) => {
  const { t } = useI18n();
  return <div className="reference-drawer-toolbar">
    <div className="library-source-row">
      <Select value={source} onChange={onSourceChange} ariaLabel={t('reference.librarySource')} options={[
        { value: 'current', label: t('reference.currentWorkspace') },
        { value: 'all', label: t('reference.libraryAllWorkspaces') },
        ...workspaces.filter(w => w.id !== activeWorkspaceId).map(w => ({ value: `workspace:${w.id}`, label: w.name })),
      ]} />
      <Select value={kind} onChange={value => onKindChange(value as LibraryKind)} ariaLabel={t('reference.libraryType')}
        options={(['all', 'note', 'link', 'artifact', 'image', 'mindmap', 'other'] as const).map(value => ({ value, label: t(`reference.libraryKind.${value}`) }))} />
    </div>
    <TextField type="search" value={query} onChange={event => onQueryChange(event.target.value)}
      aria-label={t('reference.librarySearch')} placeholder={t('reference.librarySearch')} />
  </div>;
};
