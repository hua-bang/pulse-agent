import { useEffect, useMemo, useState } from 'react';
import type { AgentScope, WorkspaceOption } from '../types';
import { CheckIcon, KnowledgeStoreIcon, WorkspaceIcon } from '../../icons';
import { useI18n } from '../../../i18n';
import { Button, Modal, TextField, useIndexNav } from '../../ui';
import './index.css';

const GLOBAL_SCOPE_ID = '__global_chat__';

interface WorkspacePickerOption {
  id: string;
  name: string;
  scope: AgentScope;
  isGlobal?: boolean;
}

interface Props {
  open: boolean;
  currentScope: AgentScope;
  workspaces: WorkspaceOption[];
  onClose: () => void;
  onConfirm: (scope: AgentScope) => Promise<boolean>;
}

const scopeKey = (scope: AgentScope): string => {
  if (scope.kind === 'workspace') return `workspace:${scope.workspaceId}`;
  if (scope.kind === 'scheduled') return `scheduled:${scope.taskId}`;
  return 'global';
};

const defaultScope = (scope: AgentScope): AgentScope => scope.kind === 'scheduled'
  ? scope
  : scope.kind === 'workspace'
    ? scope
    : { kind: 'global' };

export const ChatWorkspacePicker = ({
  open,
  currentScope,
  workspaces,
  onClose,
  onConfirm,
}: Props) => {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [selectedScope, setSelectedScope] = useState<AgentScope>(() => defaultScope(currentScope));
  const [submitting, setSubmitting] = useState(false);
  const { index, setIndex, move, reset } = useIndexNav();

  const options = useMemo<WorkspacePickerOption[]>(() => {
    const workspaceEntries = workspaces.map((workspace) => ({
      id: workspace.id,
      name: workspace.name,
      scope: { kind: 'workspace', workspaceId: workspace.id } as AgentScope,
    }));
    const currentWorkspace = currentScope.kind === 'workspace'
      && !workspaceEntries.some((workspace) => workspace.id === currentScope.workspaceId)
      ? [{
        id: currentScope.workspaceId,
        name: currentScope.workspaceId,
        scope: currentScope,
      }]
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
      id: GLOBAL_SCOPE_ID,
      name: t('chat.scope.global'),
      scope: { kind: 'global' },
      isGlobal: true,
    };
    const currentScheduled = currentScope.kind === 'scheduled'
      ? [{
        id: `scheduled:${currentScope.taskId}`,
        name: currentScope.taskId,
        scope: currentScope,
      }]
      : [];

    if (currentScope.kind === 'scheduled') {
      return [...currentScheduled, global, ...otherWorkspaces];
    }
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
    setSelectedScope(defaultScope(currentScope));
    reset(0);
    setSubmitting(false);
  }, [currentScope, open, reset]);

  useEffect(() => {
    reset(0);
  }, [query, reset]);

  const selectedKey = scopeKey(selectedScope);
  const selectedOption = options.find(option => scopeKey(option.scope) === selectedKey);
  const submit = async () => {
    if (!selectedOption || submitting) return;
    setSubmitting(true);
    try {
      if (await onConfirm(selectedOption.scope)) onClose();
    } finally {
      setSubmitting(false);
    }
  };
  const close = () => {
    if (!submitting) onClose();
  };

  return (
    <Modal open={open} onClose={close} width={520} labelledBy="chat-new-destination-title" className="chat-workspace-picker">
      <div className="chat-workspace-picker__header">
        <h2 id="chat-new-destination-title">{t('chat.newChatDestinationTitle')}</h2>
        <p>{t('chat.newChatDestinationDescription')}</p>
        <TextField
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') { event.preventDefault(); move(1, filteredOptions.length); }
            if (event.key === 'ArrowUp') { event.preventDefault(); move(-1, filteredOptions.length); }
            if (event.key === 'Enter' && filteredOptions[index]) {
              event.preventDefault();
              setSelectedScope(filteredOptions[index].scope);
            }
          }}
          placeholder={t('chat.newChatDestinationSearch')}
          role="combobox"
          aria-expanded={filteredOptions.length > 0}
          aria-controls="chat-new-destination-options"
          aria-activedescendant={filteredOptions[index] ? `chat-new-destination-option-${filteredOptions[index].id}` : undefined}
        />
      </div>
      <div id="chat-new-destination-options" className="chat-workspace-picker__options" role="listbox" aria-label={t('chat.newChatDestinationOptions')}>
        {filteredOptions.length === 0 ? (
          <div className="chat-workspace-picker__empty">{t('chat.newChatDestinationNoResults')}</div>
        ) : filteredOptions.map((option, optionIndex) => {
          const selected = scopeKey(option.scope) === selectedKey;
          return (
            <Button
              key={option.id}
              id={`chat-new-destination-option-${option.id}`}
              variant="secondary"
              size="sm"
              role="option"
              aria-selected={selected}
              data-chat-destination-index={optionIndex}
              className={`chat-workspace-picker__option${selected ? ' chat-workspace-picker__option--selected' : ''}`}
              onMouseEnter={() => setIndex(optionIndex)}
              onFocus={() => setIndex(optionIndex)}
              onClick={() => setSelectedScope(option.scope)}
            >
              <span className="chat-workspace-picker__icon">
                {option.isGlobal ? <KnowledgeStoreIcon size={16} /> : <WorkspaceIcon size={16} />}
              </span>
              <span className="chat-workspace-picker__copy">
                <strong>{option.name}</strong>
                {option.id === (currentScope.kind === 'workspace' ? currentScope.workspaceId : null) && (
                  <small>{t('chat.newChatDestinationCurrent')}</small>
                )}
              </span>
              {selected && <CheckIcon size={16} className="chat-workspace-picker__check" />}
            </Button>
          );
        })}
      </div>
      <div className="chat-workspace-picker__footer">
        <Button variant="secondary" size="sm" onClick={close} disabled={submitting}>
          {t('chat.newChatDestinationCancel')}
        </Button>
        <Button variant="primary" size="sm" onClick={() => void submit()} disabled={!selectedOption || submitting}>
          {t('chat.newChatDestinationConfirm')}
        </Button>
      </div>
    </Modal>
  );
};
