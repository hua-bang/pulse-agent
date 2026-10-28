import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './index.css';
import type { AgentContextTabRef, CanvasNode, FileNodeData } from '../../../../types';
import { isImeComposing } from '../../../../utils/ime';
import { useI18n, type I18nKey } from '../../../../i18n';
import { CANVAS_NODE_TYPE_LABEL_KEY } from '../../../../utils/nodeTypeI18n';
import { useEscapeClose } from '../../../../hooks/useEscapeClose';
import { formatShortcutId } from '../../../../shortcuts/registry';
import { useIndexNav } from '../../../../components/ui';
import { groupMentionEntries, type MentionEntry } from './mentionGroups';

interface Props {
  nodes: CanvasNode[];
  onSelect: (node: CanvasNode) => void;
  onClose: () => void;
  /** Dock tabs to offer above the nodes; shown only with `onSelectTab`. */
  tabs?: AgentContextTabRef[];
  onSelectTab?: (tab: AgentContextTabRef) => void;
}

const EMPTY_TABS: AgentContextTabRef[] = [];

const TAB_KIND_LABEL_KEY: Record<AgentContextTabRef['kind'], I18nKey> = {
  link: 'chat.tabKind.link',
  artifact: 'chat.tabKind.artifact',
  'node-detail': 'chat.tabKind.nodeDetail',
  canvas: 'chat.tabKind.canvas',
  terminal: 'chat.tabKind.terminal',
};

export const NodeMentionPicker = ({ nodes, onSelect, onClose, tabs = EMPTY_TABS, onSelectTab }: Props) => {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const { index: selectedIndex, setIndex: setSelectedIndex, move, reset } = useIndexNav();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = 'node-mention-results';

  useEscapeClose(true, onClose);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const entryTypeLabel = useCallback((entry: MentionEntry) => (
    entry.kind === 'tab'
      ? t(TAB_KIND_LABEL_KEY[entry.tab.kind])
      : t(CANVAS_NODE_TYPE_LABEL_KEY[entry.node.type])
  ), [t]);
  const groups = useMemo(() => groupMentionEntries({
    nodes,
    tabs: onSelectTab ? tabs : EMPTY_TABS,
    query,
    typeLabel: entryTypeLabel,
  }), [entryTypeLabel, nodes, onSelectTab, query, tabs]);
  const filtered = useMemo(() => groups.flatMap(group => group.entries), [groups]);
  const selectEntry = useCallback((entry: MentionEntry) => {
    if (entry.kind === 'tab') onSelectTab?.(entry.tab);
    else onSelect(entry.node);
  }, [onSelect, onSelectTab]);
  const activeOptionId = selectedIndex >= 0 && selectedIndex < filtered.length
    ? `node-mention-option-${selectedIndex}`
    : undefined;

  useEffect(() => {
    reset(0);
  }, [query, reset]);

  useEffect(() => {
    const active = listRef.current?.querySelector(`[data-node-mention-index="${selectedIndex}"]`);
    active?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (isImeComposing(e)) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      if (filtered.length === 0) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        move(1, filtered.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        move(-1, filtered.length);
        return;
      }
      if (e.key === 'Enter' && filtered[selectedIndex]) {
        selectEntry(filtered[selectedIndex]);
        return;
      }
    },
    [filtered, selectedIndex, selectEntry, onClose, move],
  );

  const placeholder = onSelectTab && tabs.length > 0
    ? t('nodeMention.searchPlaceholderWithTabs')
    : t('nodeMention.searchPlaceholder');
  let optionIndex = 0;

  return (
    <div className="node-mention-backdrop" onMouseDown={(e) => e.stopPropagation()} onClick={onClose}>
      <div className="node-mention-picker" role="dialog" aria-label={t('nodeMention.title')} onClick={(e) => e.stopPropagation()}>
        <div className="node-mention-header">
          <span className="node-mention-label">{t('nodeMention.title')}</span>
          <kbd className="node-mention-kbd">{formatShortcutId('terminal.mentionPicker')}</kbd>
        </div>
        <div className="node-mention-search">
          <input
            ref={inputRef}
            type="text"
            className="node-mention-input"
            placeholder={placeholder}
            aria-label={placeholder}
            role="combobox"
            aria-controls={filtered.length > 0 ? listId : undefined}
            aria-activedescendant={activeOptionId}
            aria-expanded={filtered.length > 0}
            aria-haspopup="listbox"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
        </div>
        <div id={listId} className="node-mention-list" role="listbox" aria-label={t('nodeMention.results')} ref={listRef}>
          {filtered.length === 0 ? (
            <div className="node-mention-empty">{t('nodeMention.empty')}</div>
          ) : (
            groups.map(group => (
              <div key={group.key} role="group" aria-labelledby={`node-mention-group-${group.key}`}>
                <div id={`node-mention-group-${group.key}`} className="node-mention-group-header">
                  {group.key === 'tab' ? t('chat.mention.tab') : t(CANVAS_NODE_TYPE_LABEL_KEY[group.key])}
                </div>
                {group.entries.map((entry) => {
                  const idx = optionIndex++;
                  const typeLabel = entryTypeLabel(entry);
                  const title = entry.kind === 'tab'
                    ? entry.tab.title || t('nodeMention.untitled')
                    : entry.node.title || t('nodeMention.untitled');
                  const filePath = entry.kind === 'node' && entry.node.type === 'file'
                    ? (entry.node.data as FileNodeData).filePath
                    : undefined;
                  const fileName = filePath ? filePath.split('/').pop() : undefined;
                  return (
                    <button
                      key={entry.key}
                      id={`node-mention-option-${idx}`}
                      type="button"
                      role="option"
                      aria-selected={idx === selectedIndex}
                      aria-label={t('nodeMention.option', { type: typeLabel, title })}
                      data-node-mention-index={idx}
                      className={`node-mention-item${idx === selectedIndex ? ' selected' : ''}`}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => selectEntry(entry)}
                      onMouseEnter={() => setSelectedIndex(idx)}
                      onFocus={() => setSelectedIndex(idx)}
                    >
                      {entry.kind === 'tab' && (
                        <span className={`node-mention-badge node-mention-badge--tab-${entry.tab.kind}`}>
                          {typeLabel}
                        </span>
                      )}
                      <span className="node-mention-title">{title}</span>
                      {fileName && <span className="node-mention-path">{fileName}</span>}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
        <div className="node-mention-hint">
          <span>{t('nodeMention.hintNavigate')}</span>
          <span>{t('nodeMention.hintInsert')}</span>
          <span>{t('nodeMention.hintClose')}</span>
        </div>
      </div>
    </div>
  );
};
