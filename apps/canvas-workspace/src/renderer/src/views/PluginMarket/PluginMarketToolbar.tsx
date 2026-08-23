import type { ReactNode } from 'react';
import {
  CaretDown,
  Check,
  FadersHorizontal,
  FolderOpen,
  Gear,
  GitBranch,
  Plus,
  ArrowsClockwise,
} from '@phosphor-icons/react';
import { Button, DropdownShell, SegmentedControl } from '../../components/ui';
import { useI18n } from '../../i18n';
import { SpinnerIcon } from '../../components/icons';
import { pluginMarketKeys as keys } from './i18nKeys';

interface ToolbarProps {
  onNavigateSkills: () => void;
  actions?: ReactNode;
}

export const PluginMarketToolbar = ({ onNavigateSkills, actions }: ToolbarProps) => {
  const { t } = useI18n();

  return (
    <div className="plugin-market__toolbar">
      <SegmentedControl
        ariaPattern="tab"
        ariaLabel={t(keys.tabsLabel)}
        className="plugin-market__product-tabs"
        value="plugins"
        options={[
          { id: 'plugins', label: t(keys.pluginsTab) },
          { id: 'skills', label: t(keys.skillsTab) },
        ]}
        onChange={(value) => {
          if (value === 'skills') onNavigateSkills();
        }}
      />
      {actions}
    </div>
  );
};

interface ActionsProps {
  refreshing: boolean;
  directoryBusy: boolean;
  onOpenSettings: () => void;
  onRefresh: () => void;
  onChooseDirectory: () => void;
  onAddGit: () => void;
}

export const PluginMarketActions = ({
  refreshing,
  directoryBusy,
  onOpenSettings,
  onRefresh,
  onChooseDirectory,
  onAddGit,
}: ActionsProps) => {
  const { t } = useI18n();

  return (
    <div className="plugin-market__toolbar-actions">
      <Button
        variant="icon"
        size="lg"
        className="plugin-market__toolbar-icon"
        aria-label={refreshing ? t(keys.refreshing) : t(keys.refresh)}
        disabled={refreshing}
        onClick={onRefresh}
      >
        {refreshing
          ? <SpinnerIcon size={17} className="plugin-market__spin" />
          : <ArrowsClockwise size={18} />}
      </Button>
      <Button
        variant="icon"
        size="lg"
        className="plugin-market__toolbar-icon"
        aria-label={t(keys.settings)}
        onClick={onOpenSettings}
      >
        <Gear size={18} />
      </Button>
      <DropdownShell
        align="end"
        ariaLabel={t(keys.addMenu)}
        panelId="plugin-market-add-menu"
        panelClassName="plugin-market__action-menu"
        trigger={({ open, toggle }) => (
          <Button
            variant="primary"
            className="plugin-market__add-button"
            aria-haspopup="menu"
            aria-expanded={open}
            aria-controls="plugin-market-add-menu"
            onClick={toggle}
          >
            <Plus size={16} />
            {t(keys.add)}
            <CaretDown size={12} />
          </Button>
        )}
      >
        {({ close }) => (
          <>
            <Button
              className="plugin-market__menu-item"
              disabled={directoryBusy}
              onClick={() => {
                close();
                onChooseDirectory();
              }}
            >
              <FolderOpen size={18} />
              <span>
                <strong>{t(keys.addDirectory)}</strong>
                <small>{t(keys.addDirectoryHint)}</small>
              </span>
            </Button>
            <Button
              className="plugin-market__menu-item"
              onClick={() => {
                close();
                onAddGit();
              }}
            >
              <GitBranch size={18} />
              <span>
                <strong>{t(keys.addGit)}</strong>
                <small>{t(keys.addGitHint)}</small>
              </span>
            </Button>
          </>
        )}
      </DropdownShell>
    </div>
  );
};

interface FilterProps {
  visibility: 'public' | 'personal';
  category: string;
  categories: string[];
  onVisibilityChange: (visibility: 'public' | 'personal') => void;
  onCategoryChange: (category: string) => void;
}

export const PluginMarketFilters = ({
  visibility,
  category,
  categories,
  onVisibilityChange,
  onCategoryChange,
}: FilterProps) => {
  const { t } = useI18n();
  const options = ['', ...categories];

  return (
    <div className="plugin-market__filters">
      <SegmentedControl
        ariaPattern="tab"
        ariaLabel={t(keys.visibilityLabel)}
        value={visibility}
        options={[
          { id: 'public', label: t(keys.public) },
          { id: 'personal', label: t(keys.personal) },
        ]}
        onChange={(value) => onVisibilityChange(value as 'public' | 'personal')}
      />
      <DropdownShell
        align="end"
        ariaLabel={t(keys.filterMenu)}
        panelId="plugin-market-filter-menu"
        panelClassName="plugin-market__filter-menu"
        trigger={({ open, toggle }) => (
          <Button
            variant="icon"
            size="lg"
            className="plugin-market__filter-button"
            aria-label={t(keys.filter)}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-controls="plugin-market-filter-menu"
            onClick={toggle}
          >
            <FadersHorizontal size={18} />
          </Button>
        )}
      >
        {({ close }) => options.map((option) => (
          <Button
            key={option || '__all'}
            className="plugin-market__filter-item"
            onClick={() => {
              onCategoryChange(option);
              close();
            }}
          >
            <Check size={14} className={category === option ? '' : 'plugin-market__check-hidden'} />
            {option || t(keys.allCategories)}
          </Button>
        ))}
      </DropdownShell>
    </div>
  );
};
