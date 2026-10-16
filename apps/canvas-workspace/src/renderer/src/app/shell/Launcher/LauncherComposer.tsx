import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { WorkspaceEntry } from '../../../shared/workspaces';
import type { AgentRequestContext, AgentScope, CanvasNode } from '../../../types';
import { Button, Select } from '../../../components/ui';
import { useI18n, type I18nKey } from '../../../i18n';
import {
  CHAT_MENTION_LISTBOX_ID,
  ChatMentionPopup,
  chatMentionOptionId,
  useMentionInput,
} from '../../../modules/chat/mentionInput';

const GLOBAL_SCOPE = '__global__';
const STARTERS: I18nKey[] = [
  'launcher.starter.plan',
  'launcher.starter.research',
  'launcher.starter.notes',
];
const NO_NODES: CanvasNode[] = [];

interface Props {
  workspaces: WorkspaceEntry[];
  /** Node snapshots this window already holds, keyed by workspace id. */
  loadedNodes: Record<string, CanvasNode[]>;
  /** Loads a workspace's nodes, so its cards can be mentioned. */
  onWorkspaceContextRequest?: (workspaceId: string) => void;
  /** Sends the question; resolves true when the composer may clear. */
  onAsk: (
    text: string,
    scope: AgentScope,
    label: string,
    context?: AgentRequestContext,
  ) => Promise<boolean>;
}

/**
 * The launcher's ask box: a question, the scope it runs in, and starters.
 * `@` mentions workspaces, roles, apps and, in a workspace scope, its cards.
 */
export const LauncherComposer = ({ workspaces, loadedNodes, onWorkspaceContextRequest, onAsk }: Props) => {
  const { t } = useI18n();
  const [scopeValue, setScopeValue] = useState(GLOBAL_SCOPE);
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const workspace = workspaces.find((item) => item.id === scopeValue);
  const scope = useMemo<AgentScope>(() => (workspace
    ? { kind: 'workspace', workspaceId: workspace.id }
    : { kind: 'global' }), [workspace?.id]);
  const nodes = workspace ? loadedNodes[workspace.id] ?? NO_NODES : NO_NODES;
  const options = [
    { value: GLOBAL_SCOPE, label: t('launcher.scopeGlobal') },
    ...workspaces.map((item) => ({ value: item.id, label: item.name })),
  ];

  useEffect(() => {
    if (workspace) onWorkspaceContextRequest?.(workspace.id);
  }, [onWorkspaceContextRequest, workspace?.id]);

  // The field reads the latest submit through a ref, so its key handler
  // does not change on every keystroke.
  const submitRef = useRef<() => void>(() => undefined);
  const handleEnter = useCallback(() => submitRef.current(), []);
  const field = useMentionInput({
    agentScope: scope,
    allWorkspaces: workspaces,
    nodes,
    onSubmit: handleEnter,
  });

  const submit = async () => {
    const question = field.input.trim();
    if (!question || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    try {
      const sent = await onAsk(question, scope, workspace?.name ?? t('chat.scope.global'), field.collectContext());
      if (sent) field.replaceInput('');
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };
  submitRef.current = () => { void submit(); };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    void submit();
  };

  useEffect(() => {
    field.editableRef.current?.focus();
  }, [field.editableRef]);

  const activeIndex = field.mentionLoading || field.mentionItems.length === 0 ? -1 : field.mentionIndex;

  return (
    <div className="launcher__composer-group">
      <form className="launcher__ask" aria-label={t('launcher.askLabel')} onSubmit={handleSubmit}>
        {field.mentionOpen && (
          <ChatMentionPopup
            mentionItems={field.mentionItems}
            mentionIndex={field.mentionIndex}
            isLoading={field.mentionLoading}
            onSelectMention={field.selectMention}
            onMentionIndexChange={field.setMentionIndex}
          />
        )}
        <div
          ref={field.editableRef}
          className="launcher__ask-input"
          contentEditable={!sending}
          role="combobox"
          aria-label={t('launcher.askLabel')}
          aria-multiline="true"
          aria-autocomplete="list"
          aria-haspopup="listbox"
          aria-expanded={field.mentionOpen}
          aria-controls={field.mentionOpen ? CHAT_MENTION_LISTBOX_ID : undefined}
          aria-activedescendant={field.mentionOpen && activeIndex >= 0 ? chatMentionOptionId(activeIndex) : undefined}
          aria-disabled={sending || undefined}
          data-placeholder={t('launcher.askPlaceholder')}
          onInput={field.handleInput}
          onKeyDown={field.handleKeyDown}
          onPaste={field.handlePaste}
        />
        <div className="launcher__ask-bar">
          <Select
            className="launcher__scope"
            value={scopeValue}
            options={options}
            onChange={(value) => { if (!sendingRef.current) setScopeValue(value); }}
            ariaLabel={t('launcher.scopeLabel')}
          />
          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={sending || !field.input.trim()}
          >
            {t('launcher.startSubmit')}
          </Button>
        </div>
      </form>
      <div className="launcher__starters">
        {STARTERS.map((key) => (
          <Button
            key={key}
            variant="secondary"
            size="xs"
            className="launcher__starter"
            disabled={sending}
            onClick={() => field.replaceInput(t(key))}
          >
            {t(key)}
          </Button>
        ))}
      </div>
    </div>
  );
};
