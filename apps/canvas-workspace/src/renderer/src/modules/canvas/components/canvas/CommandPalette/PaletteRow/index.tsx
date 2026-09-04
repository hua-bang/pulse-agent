import type { MouseEvent } from 'react';
import './index.css';
import { useI18n, type I18nKey } from '../../../../../../i18n';
import { CANVAS_NODE_TYPE_LABEL_KEY } from '../../../../../../utils/nodeTypeI18n';
import type { PaletteCommand, PaletteItem } from '../model';

const GROUP_LABEL_KEY: Record<PaletteCommand['group'], I18nKey> = {
  create: 'canvas.palette.group.create',
  navigate: 'canvas.palette.group.navigate',
  view: 'canvas.palette.group.view',
  edit: 'canvas.palette.group.edit',
  help: 'canvas.palette.group.help',
};

interface Props {
  item: PaletteItem;
  index: number;
  selected: boolean;
  onActivate: (item: PaletteItem) => void;
  onHover: (index: number) => void;
  onFocus: (index: number) => void;
}

export const PaletteRow = ({ item, index, selected, onActivate, onHover, onFocus }: Props) => {
  const { t } = useI18n();
  const className = `command-palette-row ${selected ? 'selected' : ''}`;
  const common = {
    className,
    id: `command-palette-option-${index}`,
    role: 'option',
    'aria-selected': selected,
    'data-palette-index': index,
    onMouseDown: (event: MouseEvent) => event.preventDefault(),
    onClick: () => onActivate(item),
    onMouseEnter: () => onHover(index),
    onFocus: () => onFocus(index),
  } as const;
  if (item.kind === 'node') {
    const showSnippet = !['title-prefix', 'title-contains', 'recent'].includes(item.matchType);
    const title = item.node.title || t('canvas.palette.untitled');
    const typeLabel = t(CANVAS_NODE_TYPE_LABEL_KEY[item.node.type]);
    return (
      <button type="button" {...common} aria-label={t('canvas.palette.nodeOption', { type: typeLabel, title })}>
        <div className="command-palette-row-main">
          <span className={`command-palette-badge command-palette-badge--${item.node.type}`}>{typeLabel}</span>
          <span className="command-palette-row-title">{title}</span>
        </div>
        {showSnippet && <div className="command-palette-row-hint">{item.matchText}</div>}
      </button>
    );
  }
  const groupLabel = t(GROUP_LABEL_KEY[item.command.group]);
  return (
    <button type="button" {...common} aria-label={t('canvas.palette.commandOption', { group: groupLabel, title: item.command.title })}>
      <div className="command-palette-row-main">
        <span className="command-palette-badge command-palette-badge--cmd">{groupLabel}</span>
        <span className="command-palette-row-title">{item.command.title}</span>
        {item.command.shortcut && <span className="command-palette-shortcut">{item.command.shortcut}</span>}
      </div>
      {item.command.hint && <div className="command-palette-row-hint">{item.command.hint}</div>}
    </button>
  );
};
