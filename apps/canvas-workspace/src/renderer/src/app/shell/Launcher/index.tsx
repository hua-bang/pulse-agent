import { useState, type FormEvent } from 'react';
import type { WorkspaceEntry } from '../../../shared/workspaces';
import type { ChatTarget } from '../../../modules/chat';
import { useChatTargetBroker } from '../../../modules/chat';
import { useChatDeliveryNotifier } from '../../../modules/chat/delivery';
import { PlusIcon, SparklesIcon, WorkspaceIcon } from '../../../components/icons';
import { Button, TextField } from '../../../components/ui';
import { useI18n } from '../../../i18n';
import { createGlobalChatTarget, deliverWhenReady } from './askGlobalAgent';
import './index.css';

interface Props {
  workspaces: WorkspaceEntry[];
  onEnterChat: (target: ChatTarget) => void;
  onOpenWorkspace: (id: string) => void;
  onCreateWorkspace: () => void;
}

/**
 * The launcher: one place to ask Pulse Agent or open a workspace. The `+`
 * on the workspace tabs and the Home rail button lead here.
 */
export const Launcher = ({ workspaces, onEnterChat, onOpenWorkspace, onCreateWorkspace }: Props) => {
  const { t } = useI18n();
  const broker = useChatTargetBroker();
  const notifyChatDelivery = useChatDeliveryNotifier();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const question = text.trim();
    if (!question || sending) return;
    const label = t('chat.scope.global');
    const target = createGlobalChatTarget(label);
    setSending(true);
    onEnterChat(target);
    try {
      const receipt = await deliverWhenReady(broker, target, { text: question, nodes: [] });
      if (receipt.status !== 'delivered') notifyChatDelivery(receipt, label);
      if (receipt.status === 'delivered' || receipt.status === 'queued') setText('');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="launcher">
      <div className="launcher__inner">
        <h1 className="launcher__title">{t('launcher.title')}</h1>
        <form
          className="launcher__ask"
          aria-label={t('launcher.askLabel')}
          onSubmit={(event) => { void handleSubmit(event); }}
        >
          <SparklesIcon size={16} className="launcher__ask-icon" />
          <TextField
            className="launcher__ask-input"
            value={text}
            placeholder={t('launcher.askPlaceholder')}
            aria-label={t('launcher.askLabel')}
            onChange={(event) => setText(event.target.value)}
            disabled={sending}
            autoFocus
          />
          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={sending || !text.trim()}
          >
            {t('launcher.askSubmit')}
          </Button>
        </form>

        <section className="launcher__section" aria-labelledby="launcher-workspaces">
          <h2 id="launcher-workspaces" className="launcher__section-title">
            {t('launcher.workspaces')}
          </h2>
          <div className="launcher__grid">
            <Button variant="secondary" className="launcher__card launcher__card--new" onClick={onCreateWorkspace}>
              <PlusIcon size={16} />
              <span className="launcher__card-name">{t('launcher.newWorkspace')}</span>
            </Button>
            {workspaces.map((workspace) => (
              <Button
                key={workspace.id}
                variant="secondary"
                className="launcher__card"
                onClick={() => onOpenWorkspace(workspace.id)}
                title={workspace.name}
              >
                <WorkspaceIcon size={16} />
                <span className="launcher__card-name">{workspace.name}</span>
              </Button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
};
