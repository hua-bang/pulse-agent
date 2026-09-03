import { useCallback, useState } from 'react';
import type { AgentContextTabRef } from '../../../types';
import { useI18n } from '../../../i18n';
import { SparklesIcon } from '../../icons';
import { Button } from '../../ui';
import type { ChatDeliveryReceipt } from '../../../modules/chat';
import { useChatDeliveryNotifier } from '../../../app/shell/useChatDeliveryNotifier';

interface Props {
  tab: AgentContextTabRef;
  targetWorkspaceId: string;
  onAddToChat: (workspaceId: string, tab: AgentContextTabRef) => Promise<ChatDeliveryReceipt>;
  iconOnly?: boolean;
  className?: string;
}

export const TabChatAction = ({
  tab,
  targetWorkspaceId,
  onAddToChat,
  iconOnly = false,
  className,
}: Props) => {
  const { t } = useI18n();
  const notifyChatDelivery = useChatDeliveryNotifier();
  const [sending, setSending] = useState(false);
  const label = t('rightDock.addTabToChat', { title: tab.title || tab.url || tab.kind });

  const handleClick = useCallback(async () => {
    if (sending) return;
    setSending(true);
    try {
      const receipt = await onAddToChat(targetWorkspaceId, tab);
      notifyChatDelivery(receipt, tab.title || tab.url || tab.kind);
    } catch (error) {
      notifyChatDelivery({
        status: 'failed',
        target: null,
        error: error instanceof Error ? error.message : String(error),
      }, tab.title || tab.url || tab.kind);
    } finally {
      setSending(false);
    }
  }, [notifyChatDelivery, onAddToChat, sending, tab, targetWorkspaceId]);

  return (
    <Button
      variant={iconOnly ? 'icon' : 'secondary'}
      size="xs"
      className={className}
      aria-label={label}
      title={label}
      disabled={sending}
      onClick={() => { void handleClick(); }}
    >
      <SparklesIcon size={12} />
      {!iconOnly && t('rightDock.askAi')}
    </Button>
  );
};
