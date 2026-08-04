import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { useI18n } from '../../i18n';
import { DockAgentTabIcon } from './DockAgentTabIcon';
import { DockTabIcon } from './DockTabIcon';
import type { DockTerminalTab } from './dock-store';
import type { DockTabVisualState } from './dock-tab-visual-state';
import { dockPaneElementId, dockTabElementId } from './dock-tab-ids';

interface TerminalDockTabProps {
  tab: DockTerminalTab;
  visual: DockTabVisualState;
  tabIndex: number;
  registerTab: (id: string, element: HTMLButtonElement | null) => void;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDragStart: (event: DragEvent<HTMLElement>, id: string) => void;
  onDragOver: (event: DragEvent<HTMLElement>, id: string) => void;
  onDrop: (event: DragEvent<HTMLElement>, id: string) => void;
  onDragEnd: () => void;
}

export const TerminalDockTab = ({
  tab,
  visual,
  tabIndex,
  registerTab,
  onActivate,
  onClose,
  onRename,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: TerminalDockTabProps) => {
  const { t } = useI18n();
  const agentDefaultTitle = tab.agentType === 'claude-code'
    ? `Claude ${tab.ordinal}`
    : tab.agentType === 'codex'
      ? `Codex ${tab.ordinal}`
      : tab.agentType === 'pi'
        ? `Pi ${tab.ordinal}`
        : undefined;
  const defaultTitle = agentDefaultTitle ?? t('rightDock.terminalNumber', { number: tab.ordinal });
  const title = tab.title ?? defaultTitle;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const cancelingRef = useRef(false);

  useEffect(() => {
    if (!editing) setDraft(title);
  }, [editing, title]);

  useEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  const startRename = () => {
    cancelingRef.current = false;
    setDraft(title);
    setEditing(true);
    onActivate(tab.id);
  };

  const commitRename = () => {
    if (cancelingRef.current) {
      cancelingRef.current = false;
      return;
    }
    const nextTitle = draft.trim();
    if (nextTitle && nextTitle !== title) onRename(tab.id, nextTitle);
    setEditing(false);
  };

  const cancelRename = () => {
    cancelingRef.current = true;
    setDraft(title);
    setEditing(false);
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();
    if (event.key === 'Enter') {
      event.preventDefault();
      commitRename();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancelRename();
    }
  };

  return (
    <span
      className="right-dock__tab-shell"
      data-split-visible={visual.splitVisible}
      data-split-part={visual.splitPart}
      onDragOver={(event) => onDragOver(event, tab.id)}
      onDrop={(event) => onDrop(event, tab.id)}
    >
      <button
        ref={(element) => registerTab(tab.id, element)}
        type="button"
        id={dockTabElementId(tab.id)}
        data-dock-tab-id={tab.id}
        role="tab"
        aria-controls={dockPaneElementId(tab.id)}
        aria-selected={visual.selected}
        aria-expanded={visual.splitActive ? visual.splitVisible : undefined}
        className={`right-dock__tab right-dock__tab--with-close${visual.focused ? ' right-dock__tab--active' : ''}`}
        data-focused={visual.focused}
        data-split-visible={visual.splitVisible}
        title={`${title} - ${t('rightDock.renameTerminalHint')}`}
        tabIndex={tabIndex}
        draggable={!editing}
        onDragStart={(event) => onDragStart(event, tab.id)}
        onDragEnd={onDragEnd}
        onMouseDown={(event) => {
          // Activate on mouse-down: once the gesture turns into a drag the
          // browser suppresses the click, so click-only activation reads as
          // "tab didn't respond" after a few px of pointer slip.
          if (event.button === 0) onActivate(tab.id);
        }}
        onClick={() => onActivate(tab.id)}
        onDoubleClick={startRename}
        onKeyDown={(event) => {
          if (event.key === 'F2') {
            event.preventDefault();
            startRename();
          }
        }}
      >
        {tab.agentType
          ? <DockAgentTabIcon agentType={tab.agentType} />
          : <DockTabIcon kind="terminal" />}
        <span className={`right-dock__tab-title${editing ? ' right-dock__tab-title--editing' : ''}`}>
          {title}
        </span>
      </button>
      {editing && (
        <input
          ref={inputRef}
          className="right-dock__tab-rename-input"
          value={draft}
          maxLength={64}
          aria-label={t('rightDock.terminalNameInput')}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commitRename}
          onClick={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
          onKeyDown={handleInputKeyDown}
        />
      )}
      <button
        type="button"
        aria-label={t('rightDock.closeTab', { title })}
        title={t('rightDock.closeTab', { title })}
        className="right-dock__tab-close"
        onClick={(e) => {
          e.stopPropagation();
          onClose(tab.id);
        }}
      >
        ×
      </button>
    </span>
  );
};
