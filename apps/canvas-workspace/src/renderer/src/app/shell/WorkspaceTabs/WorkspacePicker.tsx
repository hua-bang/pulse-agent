import { useMemo, useState, type KeyboardEvent, type RefObject } from 'react';
import type { WorkspaceEntry } from '../../../shared/workspaces';
import { AppLogoIcon, PlusIcon, WorkspaceIcon } from '../../../components/icons';
import { Button, Popover, TextField } from '../../../components/ui';
import { useI18n } from '../../../i18n';
import { readRecentWorkspaceIds } from '../recentWorkspaces';

interface Props {
  anchorRef: RefObject<HTMLButtonElement>;
  workspaces: WorkspaceEntry[];
  activeId: string;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onOpenLauncher: () => void;
  onClose: () => void;
}

/** Workspaces, most recently opened first, then the rest in sidebar order. */
const byRecency = (workspaces: WorkspaceEntry[]): WorkspaceEntry[] => {
  const rank = new Map(readRecentWorkspaceIds().map((id, index) => [id, index]));
  return workspaces
    .map((workspace, index) => ({ workspace, index }))
    .sort((a, b) => {
      const ra = rank.get(a.workspace.id) ?? Number.MAX_SAFE_INTEGER;
      const rb = rank.get(b.workspace.id) ?? Number.MAX_SAFE_INTEGER;
      return ra - rb || a.index - b.index;
    })
    .map(({ workspace }) => workspace);
};

/**
 * The tab bar's "+" menu: filter and open any workspace in a tab, create a
 * new one, or go to the launcher.
 */
export const WorkspacePicker = ({
  anchorRef,
  workspaces,
  activeId,
  onSelect,
  onCreate,
  onOpenLauncher,
  onClose,
}: Props) => {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const ordered = useMemo(() => byRecency(workspaces), [workspaces]);
  const needle = query.trim().toLowerCase();
  const matches = needle
    ? ordered.filter((workspace) => workspace.name.toLowerCase().includes(needle))
    : ordered;

  const choose = (action: () => void) => {
    onClose();
    action();
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
    event.preventDefault();
    const first = matches[0];
    if (first) choose(() => onSelect(first.id));
  };

  return (
    <Popover
      anchorRef={anchorRef}
      placement="bottom"
      align="start"
      gap={4}
      autoFocus={false}
      ariaLabel={t('workspaceTabs.open')}
      className="workspace-picker"
      onClose={onClose}
    >
      <TextField
        autoFocus
        className="workspace-picker__search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={handleInputKeyDown}
        placeholder={t('rightDock.searchWorkspaces')}
        aria-label={t('rightDock.searchWorkspaces')}
      />
      <div className="workspace-picker__list">
        {matches.map((workspace) => (
          <Button
            key={workspace.id}
            size="sm"
            role="menuitem"
            className="workspace-picker__item"
            aria-current={workspace.id === activeId ? 'page' : undefined}
            onClick={() => choose(() => onSelect(workspace.id))}
            title={workspace.name}
          >
            <WorkspaceIcon size={13} />
            <span className="workspace-picker__name">{workspace.name}</span>
          </Button>
        ))}
        {matches.length === 0 && (
          <div className="workspace-picker__empty">{t('rightDock.noWorkspacesFound')}</div>
        )}
      </div>
      <div className="workspace-picker__separator" />
      <Button size="sm" role="menuitem" className="workspace-picker__item" onClick={() => choose(onCreate)}>
        <PlusIcon size={13} />
        <span className="workspace-picker__name">{t('launcher.newWorkspace')}</span>
      </Button>
      <Button size="sm" role="menuitem" className="workspace-picker__item" onClick={() => choose(onOpenLauncher)}>
        <AppLogoIcon size={13} className="workspace-picker__logo" />
        <span className="workspace-picker__name">{t('sidebar.aiChat')}</span>
      </Button>
    </Popover>
  );
};
