import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useI18n } from '../../i18n';
import { AgentIcon } from '../AgentNodeBody/AgentIcon';
import { NodeTypeIcon } from '../icons';
import type { DockTerminalTab } from './dock-store';

interface TerminalDockTabProps {
  tab: DockTerminalTab;
  active: boolean;
  registerTab: (id: string, element: HTMLButtonElement | null) => void;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onRename: (id: string, title: string) => void;
}

export const TerminalDockTab = ({
  tab,
  active,
  registerTab,
  onActivate,
  onClose,
  onRename,
}: TerminalDockTabProps) => {
  const { t } = useI18n();
  const defaultTitle = t('rightDock.terminalNumber', { number: tab.ordinal });
  const title = tab.title ?? defaultTitle;
  const agentIconModifier = tab.agentType === 'claude-code' || tab.agentType === 'codex'
    ? ` right-dock__tab-icon--agent-${tab.agentType}`
    : '';
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
    <span className="right-dock__tab-shell">
      <button
        ref={(element) => registerTab(tab.id, element)}
        type="button"
        role="tab"
        aria-selected={active}
        className={`right-dock__tab right-dock__tab--with-close${active ? ' right-dock__tab--active' : ''}`}
        title={`${title} - ${t('rightDock.renameTerminalHint')}`}
        onClick={() => onActivate(tab.id)}
        onDoubleClick={startRename}
        onKeyDown={(event) => {
          if (event.key === 'F2') {
            event.preventDefault();
            startRename();
          }
        }}
      >
        <span
          className={`right-dock__tab-icon right-dock__tab-icon--terminal${
            tab.agentType ? ` right-dock__tab-icon--agent${agentIconModifier}` : ''
          }`}
          aria-hidden="true"
        >
          {tab.agentType ? <AgentIcon id={tab.agentType} size={14} /> : <NodeTypeIcon type="terminal" size={14} />}
        </span>
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
