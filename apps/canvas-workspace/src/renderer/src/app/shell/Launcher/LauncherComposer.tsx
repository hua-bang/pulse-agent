import { useState, type FormEvent, type KeyboardEvent } from 'react';
import type { WorkspaceEntry } from '../../../shared/workspaces';
import type { AgentScope } from '../../../types';
import { Button, Select, TextField } from '../../../components/ui';
import { useI18n, type I18nKey } from '../../../i18n';

const GLOBAL_SCOPE = '__global__';
const STARTERS: I18nKey[] = [
  'launcher.starter.plan',
  'launcher.starter.research',
  'launcher.starter.notes',
];

interface Props {
  workspaces: WorkspaceEntry[];
  /** Sends the question; resolves true when the composer may clear. */
  onAsk: (text: string, scope: AgentScope, label: string) => Promise<boolean>;
}

/** The launcher's ask box: a question, the scope it runs in, and starters. */
export const LauncherComposer = ({ workspaces, onAsk }: Props) => {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const [scopeValue, setScopeValue] = useState(GLOBAL_SCOPE);
  const [sending, setSending] = useState(false);
  const options = [
    { value: GLOBAL_SCOPE, label: t('launcher.scopeGlobal') },
    ...workspaces.map((workspace) => ({ value: workspace.id, label: workspace.name })),
  ];

  const submit = async () => {
    const question = text.trim();
    if (!question || sending) return;
    const workspace = workspaces.find((item) => item.id === scopeValue);
    const scope: AgentScope = workspace
      ? { kind: 'workspace', workspaceId: workspace.id }
      : { kind: 'global' };
    setSending(true);
    try {
      if (await onAsk(question, scope, workspace?.name ?? t('chat.scope.global'))) setText('');
    } finally {
      setSending(false);
    }
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    void submit();
  };

  // Enter sends; Shift+Enter and IME composition keep typing.
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void submit();
  };

  return (
    <div className="launcher__composer-group">
      <form className="launcher__ask" aria-label={t('launcher.askLabel')} onSubmit={handleSubmit}>
        <TextField
          multiline
          rows={2}
          className="launcher__ask-input"
          value={text}
          placeholder={t('launcher.askPlaceholder')}
          aria-label={t('launcher.askLabel')}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={handleKeyDown}
          disabled={sending}
          autoFocus
        />
        <div className="launcher__ask-bar">
          <Select
            className="launcher__scope"
            value={scopeValue}
            options={options}
            onChange={setScopeValue}
            ariaLabel={t('launcher.scopeLabel')}
          />
          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={sending || !text.trim()}
          >
            {t('launcher.askSubmit')}
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
            onClick={() => setText(t(key))}
          >
            {t(key)}
          </Button>
        ))}
      </div>
    </div>
  );
};
