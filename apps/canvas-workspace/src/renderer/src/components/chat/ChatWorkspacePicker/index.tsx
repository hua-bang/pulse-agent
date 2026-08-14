import { useEffect, useMemo, useState, type RefObject } from 'react';
import { GLOBAL_CHAT_STORE_ID, scopeSessionStoreId } from '../../../../../shared/agent-chat';
import { useI18n } from '../../../i18n';
import { Button, Popover, TextField, useIndexNav } from '../../ui';
import { CheckIcon, KnowledgeStoreIcon, WorkspaceIcon } from '../../icons';
import type { AgentScope, WorkspaceOption } from '../types';
import './index.css';

export const CHAT_WORKSPACE_PICKER_ID = 'chat-workspace-picker';

interface WorkspacePickerOption {
  id: string;
  name: string;
  scope: AgentScope;
  isGlobal?: boolean;
}

interface Props {
  open: boolean;
  anchorRef: RefObject<HTMLElement>;
  currentScope: AgentScope;
  workspaces: WorkspaceOption[];
  onClose: () => void;
  onConfirm: (scope: AgentScope) => Promise<boolean>;
}

const defaultScope = (scope: AgentScope): AgentScope => scope.kind === 'workspace'
  ? scope
  : { kind: 'global' };

export const ChatWorkspacePicker = ({
  open,
  anchorRef,
  currentScope,
  workspaces,
  onClose,
  onConfirm,
}: Props) => {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [submittingScopeKey, setSubmittingScopeKey] = useState<string | null>(null);
  const { index, setIndex, move, reset } = useIndexNav();

  const options = useMemo<WorkspacePickerOption[]>(() => {
    const workspaceEntries = workspaces.map((workspace) => ({
      id: workspace.id,
      name: workspace.name,
      scope: { kind: 'workspace', workspaceId: workspace.id } as AgentScope,
    }));
    const currentWorkspace = currentScope.kind === 'workspace'
      && !workspaceEntries.some((workspace) => workspace.id === currentScope.workspaceId)
      ? [{ id: currentScope.workspaceId, name: currentScope.workspaceId, scope: currentScope }]
      : [];
    const currentWorkspaceId = currentScope.kind === 'workspace' ? currentScope.workspaceId : null;
    const otherWorkspaces = [...currentWorkspace, ...workspaceEntries]
      .filter((workspace, workspaceIndex, all) => (
        all.findIndex(candidate => candidate.id === workspace.id) === workspaceIndex
      ))
      .sort((left, right) => {
        if (left.id === currentWorkspaceId) return -1;
        if (right.id === currentWorkspaceId) return 1;
        return left.name.localeCompare(right.name);
      });
    const global: WorkspacePickerOption = {
      id: GLOBAL_CHAT_STORE_ID,
      name: t('chat.scope.global'),
      scope: { kind: 'global' },
      isGlobal: true,
    };
    if (currentWorkspaceId && otherWorkspaces[0]) {
      return [otherWorkspaces[0], global, ...otherWorkspaces.slice(1)];
    }
    return [global, ...otherWorkspaces];
  }, [currentScope, t, workspaces]);

  const filteredOptions = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return options;
    return options.filter(option => option.name.toLocaleLowerCase().includes(normalized));
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setSubmittingScopeKey(null);
    reset(0);
  }, [open, reset]);

  useEffect(() => {
    reset(0);
  }, [query, reset]);

  useEffect(() => {
    if (!open) return;
    const activeOption = document.getElementById(`chat-new-destination-option-${filteredOptions[index]?.id}`);
    activeOption?.scrollIntoView?.({ block: 'nearest' });
  }, [filteredOptions, index, open]);

  const chooseScope = async (scope: AgentScope) => {
    if (submittingScopeKey) return;
    const scopeKey = scopeSessionStoreId(scope);
    setSubmittingScopeKey(scopeKey);
    try {
      if (await onConfirm(scope)) onClose();
    } finally {
      setSubmittingScopeKey(null);
    }
  };

  if (!open) return null;
  const currentScopeKey = scopeSessionStoreId(defaultScope(currentScope));

  return (
    <Popover
      anchorRef={anchorRef}
      placement="bottom"
      align="start"
      gap={6}
      viewportMargin={8}
      onClose={(reason) => {
        if (submittingScopeKey) return;
        if (reason === 'escape') anchorRef.current?.focus();
        onClose();
      }}
      role="group"
      ariaLabel={t('chat.newChatDestinationTitle')}
      panelId={CHAT_WORKSPACE_PICKER_ID}
      className="chat-workspace-picker"
      autoFocus={false}
      keyboardNavigation={false}
    >
      <div className="chat-workspace-picker__search">
        <TextField
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') { event.preventDefault(); move(1, filteredOptions.length); }
            if (event.key === 'ArrowUp') { event.preventDefault(); move(-1, filteredOptions.length); }
            if (event.key === 'Enter' && filteredOptions[index]) {
              event.preventDefault();
              void chooseScope(filteredOptions[index].scope);
            }
          }}
          placeholder={t('chat.newChatDestinationSearch')}
          role="combobox"
          aria-expanded
          aria-controls="chat-new-destination-options"
          aria-activedescendant={filteredOptions[index] ? `chat-new-destination-option-${filteredOptions[index].id}` : undefined}
        />
      </div>
      <div id="chat-new-destination-options" className="chat-workspace-picker__options" role="listbox" aria-label={t('chat.newChatDestinationOptions')}>
        {filteredOptions.length === 0 ? (
          <div className="chat-workspace-picker__empty">{t('chat.newChatDestinationNoResults')}</div>
        ) : filteredOptions.map((option, optionIndex) => {
          const current = scopeSessionStoreId(option.scope) === currentScopeKey;
          return (
            <Button
              key={option.id}
              id={`chat-new-destination-option-${option.id}`}
              variant="secondary"
              size="sm"
              role="option"
              aria-selected={current}
              disabled={submittingScopeKey !== null}
              className={`chat-workspace-picker__option${current ? ' chat-workspace-picker__option--current' : ''}${optionIndex === index ? ' chat-workspace-picker__option--active' : ''}`}
              onMouseEnter={() => setIndex(optionIndex)}
              onFocus={() => setIndex(optionIndex)}
              onClick={() => void chooseScope(option.scope)}
            >
              <span className="chat-workspace-picker__icon">
                {option.isGlobal ? <KnowledgeStoreIcon size={15} /> : <WorkspaceIcon size={15} />}
              </span>
              <span className="chat-workspace-picker__copy">
                <strong>{option.name}</strong>
                {current && currentScope.kind === 'workspace' && (
                  <small>{t('chat.newChatDestinationCurrent')}</small>
                )}
              </span>
              {current && <CheckIcon size={15} className="chat-workspace-picker__check" />}
            </Button>
          );
        })}
      </div>
    </Popover>
  );
};
