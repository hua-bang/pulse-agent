import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './index.css';
import type { CanvasNode, FileNodeData } from '../../types';
import { isImeComposing } from '../../utils/ime';
import { useI18n } from '../../i18n';
import { CANVAS_NODE_TYPE_LABEL_KEY } from '../../utils/nodeTypeI18n';
import { useEscapeClose } from '../../hooks/useEscapeClose';

interface Props {
  nodes: CanvasNode[];
  onSelect: (node: CanvasNode) => void;
  onClose: () => void;
  /**
   * How this picker was opened, shown as the trigger hint in the header.
   * Textarea surfaces pass `'@'` (inline trigger); terminals keep the
   * keyboard shortcut. Defaults to {@link NODE_MENTION_SHORTCUT}.
   */
  triggerHint?: string;
}

const MAX_RESULTS = 20;

/** Keyboard shortcut that opens the node mention picker in terminal surfaces. */
export const NODE_MENTION_SHORTCUT = 'Ctrl/⌘+2';

export const NodeMentionPicker = ({ nodes, onSelect, onClose, triggerHint = NODE_MENTION_SHORTCUT }: Props) => {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = 'node-mention-results';

  useEscapeClose(true, onClose);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filtered = useMemo((): CanvasNode[] => {
    if (!query.trim()) return nodes.slice(0, MAX_RESULTS);
    const q = query.toLowerCase();
    return nodes
      .filter((n) => {
        if (n.title.toLowerCase().includes(q)) return true;
        if (t(CANVAS_NODE_TYPE_LABEL_KEY[n.type]).toLowerCase().includes(q)) return true;
        if (n.type === 'file') {
          const fp = (n.data as FileNodeData).filePath ?? '';
          return fp.toLowerCase().includes(q);
        }
        return false;
      })
      .slice(0, MAX_RESULTS);
  }, [query, nodes, t]);
  const activeOptionId = selectedIndex >= 0 && selectedIndex < filtered.length
    ? `node-mention-option-${selectedIndex}`
    : undefined;

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

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
        setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === 'Enter' && filtered[selectedIndex]) {
        onSelect(filtered[selectedIndex]);
        return;
      }
    },
    [filtered, selectedIndex, onSelect, onClose],
  );

  return (
    <div className="node-mention-backdrop" onMouseDown={(e) => e.stopPropagation()} onClick={onClose}>
      <div className="node-mention-picker" role="dialog" aria-label={t('nodeMention.title')} onClick={(e) => e.stopPropagation()}>
        <div className="node-mention-header">
          <span className="node-mention-label">{t('nodeMention.title')}</span>
          <kbd className="node-mention-kbd">{triggerHint}</kbd>
        </div>
        <div className="node-mention-search">
          <input
            ref={inputRef}
            type="text"
            className="node-mention-input"
            placeholder={t('nodeMention.searchPlaceholder')}
            aria-label={t('nodeMention.searchPlaceholder')}
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
            filtered.map((node, idx) => {
              const filePath = node.type === 'file' ? (node.data as FileNodeData).filePath : undefined;
              const fileName = filePath ? filePath.split('/').pop() : undefined;
              return (
                <button
                  key={node.id}
                  id={`node-mention-option-${idx}`}
                  type="button"
                  role="option"
                  aria-selected={idx === selectedIndex}
                  aria-label={t('nodeMention.option', {
                    type: t(CANVAS_NODE_TYPE_LABEL_KEY[node.type]),
                    title: node.title || t('nodeMention.untitled'),
                  })}
                  data-node-mention-index={idx}
                  className={`node-mention-item${idx === selectedIndex ? ' selected' : ''}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => onSelect(node)}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  onFocus={() => setSelectedIndex(idx)}
                >
                  <span className={`node-mention-badge node-mention-badge--${node.type}`}>
                    {t(CANVAS_NODE_TYPE_LABEL_KEY[node.type])}
                  </span>
                  <span className="node-mention-title">{node.title || t('nodeMention.untitled')}</span>
                  {fileName && <span className="node-mention-path">{fileName}</span>}
                </button>
              );
            })
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
