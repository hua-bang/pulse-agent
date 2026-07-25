import { useEffect } from 'react';
import { MagnifyingGlass } from '@phosphor-icons/react';
import {
  groupSlashCommands,
  type SlashCmd,
} from '../../editor/slashCommands';
import { useI18n } from '../../i18n';
import { EditorCommandIcon } from '../EditorCommandIcon';
import { Button, Popover } from '../ui';
import './index.css';

interface Props {
  panelId: string;
  x: number;
  y: number;
  query: string;
  selectedIndex: number;
  items: SlashCmd[];
  onSelect: (command: SlashCmd) => void;
  onClose: () => void;
}

export const SlashCommandMenu = ({
  panelId,
  x,
  y,
  query,
  selectedIndex,
  items,
  onSelect,
  onClose,
}: Props) => {
  const { t } = useI18n();
  const activeIndex = Math.min(selectedIndex, items.length - 1);
  const activeItem = items[activeIndex];
  const groups = groupSlashCommands(items);

  useEffect(() => {
    if (!activeItem) return;
    document.getElementById(`${panelId}-${activeItem.id}`)?.scrollIntoView({ block: 'nearest' });
  }, [activeItem, panelId]);

  return (
    <Popover
      x={x}
      y={y + 6}
      className="slash-menu"
      role="listbox"
      panelId={panelId}
      ariaLabel={t('slashCommand.label')}
      autoFocus={false}
      keyboardNavigation={false}
      closeOnCanvasMotion
      onClose={onClose}
    >
      <div className="slash-menu-search" aria-label={t('slashCommand.search')}>
        <MagnifyingGlass size={15} weight="regular" aria-hidden="true" />
        <span className="slash-menu-search-query">/{query}</span>
      </div>

      <div className="slash-menu-results">
        {groups.map((group) => (
          <section className="slash-menu-group" key={group.id}>
            <div className="slash-menu-header">{t(group.labelKey)}</div>
            {group.items.map((item) => {
              const itemIndex = items.indexOf(item);
              const label = t(item.labelKey);
              const description = t(item.descKey);
              return (
                <Button
                  key={item.id}
                  id={`${panelId}-${item.id}`}
                  size="sm"
                  className={`slash-menu-item${
                    itemIndex === activeIndex ? ' slash-menu-item--active' : ''
                  }`}
                  role="option"
                  aria-selected={itemIndex === activeIndex}
                  aria-label={`${label}: ${description}`}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    onSelect(item);
                  }}
                >
                  <span className="slash-menu-icon">
                    <EditorCommandIcon icon={item.icon} />
                  </span>
                  <span className="slash-menu-label">
                    <strong>{label}</strong>
                    <small>{description}</small>
                  </span>
                </Button>
              );
            })}
          </section>
        ))}
        {items.length === 0 && (
          <div className="slash-menu-empty">{t('slashCommand.noResults')}</div>
        )}
      </div>

      <div className="slash-menu-footer" aria-hidden="true">
        <span>{t('slashCommand.hintNavigate')}</span>
        <span>{t('slashCommand.hintInsert')}</span>
        <span>{t('slashCommand.hintClose')}</span>
      </div>
    </Popover>
  );
};
