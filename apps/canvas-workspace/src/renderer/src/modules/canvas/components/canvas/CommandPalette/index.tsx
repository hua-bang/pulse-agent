import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './index.css';
import type { CanvasNode } from '../../../../../types';
import { isImeComposing } from '../../../../../utils/ime';
import { useI18n, type I18nKey } from '../../../../../i18n';
import { useIndexNav } from '../../../../../components/ui';
import {
  buildPaletteSections,
  type PaletteCommand,
  type PaletteItem,
  type PaletteSectionId,
} from './model';
import { PaletteRow } from './PaletteRow';

export type { PaletteCommand } from './model';

/**
 * A single executable entry in the palette. Commands are bound by the
 * caller (Canvas/index.tsx) — the palette only routes selection back
 * to `command.run()` and dismisses itself.
 */
const GROUP_LABEL_KEY: Record<PaletteCommand['group'], I18nKey> = {
  create: 'canvas.palette.group.create',
  navigate: 'canvas.palette.group.navigate',
  view: 'canvas.palette.group.view',
  edit: 'canvas.palette.group.edit',
  help: 'canvas.palette.group.help',
};
const SECTION_LABEL_KEY: Record<PaletteSectionId, I18nKey> = {
  ...GROUP_LABEL_KEY,
  nodes: 'canvas.palette.section.nodes',
  commands: 'canvas.palette.section.commands',
  recent: 'canvas.palette.section.recentNodes',
};

interface Props {
  nodes: CanvasNode[];
  commands: PaletteCommand[];
  onSelectNode: (node: CanvasNode) => void;
  onClose: () => void;
}

/**
 * Cmd+K palette — unified search-and-command surface for the canvas.
 *
 * Two kinds of items mix in one keyboard-navigated list:
 *   - **Nodes**: the existing search behavior (title / filename /
 *     content), so the user can jump to anything that's already on the
 *     canvas.
 *   - **Commands**: caller-supplied actions (create node, fit all,
 *     toggle chat, …). They don't need to be on the canvas to be
 *     reachable.
 *
 * The split is intentional: when you type "agent" and there's already
 * an agent node, you usually want to jump to it, but if you don't we
 * still surface "Create agent" so the panel is always actionable.
 */
export const CommandPalette = ({ nodes, commands, onSelectNode, onClose }: Props) => {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const { index: selectedIndex, setIndex: setSelectedIndex, move, home, end, reset } = useIndexNav();
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const sections = useMemo(
    () => buildPaletteSections(nodes, commands, query),
    [commands, nodes, query],
  );

  // Flat list of items in display order — what arrow-key navigation
  // walks. Section headers don't get a slot; selectedIndex points
  // straight at items.
  const flatItems = useMemo(
    () => sections.flatMap((s) => s.items),
    [sections],
  );
  const resultsId = 'command-palette-results';
  const activeOptionId = selectedIndex >= 0 && selectedIndex < flatItems.length
    ? `command-palette-option-${selectedIndex}`
    : undefined;

  useEffect(() => {
    reset(0);
  }, [query, reset]);

  useEffect(() => {
    const container = resultsRef.current;
    if (!container) return;
    const selected = container.querySelector(`[data-palette-index="${selectedIndex}"]`) as HTMLElement | null;
    selected?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const runItem = useCallback(
    (item: PaletteItem) => {
      if (item.kind === 'node') {
        onSelectNode(item.node);
      } else {
        item.command.run();
      }
      onClose();
    },
    [onSelectNode, onClose],
  );

  const handleInputKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // IME composition owns Enter (confirm candidate), Escape (dismiss
      // candidate), and the arrow keys (navigate candidates) — don't run
      // a command or close the palette mid-composition.
      if (isImeComposing(e)) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (flatItems.length === 0) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        move(1, flatItems.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        move(-1, flatItems.length);
        return;
      }
      if (e.key === 'Enter' && flatItems[selectedIndex]) {
        runItem(flatItems[selectedIndex]);
        return;
      }
    },
    [flatItems, selectedIndex, runItem, onClose, move],
  );

  const handleResultsKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (isImeComposing(e)) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (flatItems.length === 0) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        move(1, flatItems.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        move(-1, flatItems.length);
        return;
      }
      if (e.key === 'Home') {
        e.preventDefault();
        home();
        return;
      }
      if (e.key === 'End') {
        e.preventDefault();
        end(flatItems.length);
      }
    },
    [flatItems.length, onClose, move, home, end],
  );

  let runningIndex = 0;

  return (
    <div className="command-palette-overlay" onClick={onClose} onWheel={(e) => e.stopPropagation()}>
      <div className="command-palette" role="dialog" aria-modal="true" aria-label={t('canvas.palette.label')} onClick={(e) => e.stopPropagation()}>
        <div className="command-palette-input-wrapper">
          <svg className="command-palette-icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            className="command-palette-input"
            placeholder={t('canvas.palette.placeholder')}
            aria-label={t('canvas.palette.placeholder')}
            role="combobox"
            aria-controls={flatItems.length > 0 ? resultsId : undefined}
            aria-activedescendant={activeOptionId}
            aria-expanded={flatItems.length > 0}
            aria-haspopup="listbox"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleInputKeyDown}
          />
        </div>

        <div
          id={resultsId}
          className="command-palette-results"
          ref={resultsRef}
          role="listbox"
          aria-label={t('canvas.palette.results')}
          onKeyDown={handleResultsKeyDown}
        >
          {flatItems.length === 0 ? (
            <div className="command-palette-empty">{t('canvas.palette.noMatches')}</div>
          ) : (
            sections.map((section) => (
              <div key={section.id} className="command-palette-section">
                <div className="command-palette-section-label">{t(SECTION_LABEL_KEY[section.id])}</div>
                {section.items.map((item) => {
                  const idx = runningIndex++;
                  const isSelected = idx === selectedIndex;
                  return (
                    <PaletteRow
                      key={item.kind === 'node' ? `node:${item.node.id}` : `cmd:${item.command.id}`}
                      item={item}
                      index={idx}
                      selected={isSelected}
                      onActivate={runItem}
                      onHover={setSelectedIndex}
                      onFocus={setSelectedIndex}
                    />
                  );
                })}
              </div>
            ))
          )}
        </div>

        <div className="command-palette-hint">
          <span>{t('canvas.palette.hint.navigate')}</span>
          <span>{t('canvas.palette.hint.run')}</span>
          <span>{t('canvas.palette.hint.close')}</span>
        </div>
      </div>
    </div>
  );
};
