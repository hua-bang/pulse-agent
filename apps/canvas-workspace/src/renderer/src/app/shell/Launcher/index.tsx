import type { WorkspaceEntry } from '../../../shared/workspaces';
import type { CanvasNode } from '../../../types';
import type { AgentNewSessionResult, AgentRequestContext, AgentScope } from '../../../types';
import type { ChatTarget } from '../../../modules/chat';
import { useChatTargetBroker } from '../../../modules/chat';
import { useChatDeliveryNotifier } from '../../../modules/chat/delivery';
import { createChatPageSessionTarget, scopeFromSessionStoreId } from '../../../modules/chat/session';
import { useI18n } from '../../../i18n';
import { deliverWhenReady } from './chatPageTarget';
import { LauncherComposer } from './LauncherComposer';
import { RecentChats } from './RecentChats';
import { RecentWorkspaces } from './RecentWorkspaces';
import { useLauncherData, type RecentChat } from './useLauncherData';
import './index.css';

interface Props {
  workspaces: WorkspaceEntry[];
  /** Node snapshots this window already holds, keyed by workspace id. */
  loadedNodes: Record<string, CanvasNode[]>;
  /** Loads a workspace's nodes, so the composer can mention its cards. */
  onWorkspaceContextRequest?: (workspaceId: string) => void;
  onEnterChat: (target: ChatTarget) => void;
  onOpenSession: (scope: AgentScope, sessionId: string, scopeLabel: string) => void;
  /** Opens the chat page, whose session list holds every conversation. */
  onOpenAllChats: () => void;
  onOpenWorkspace: (id: string) => void;
  onCreateWorkspace: () => void;
}

/**
 * The launcher: ask Pulse Agent, pick up a recent workspace, or reopen a
 * recent chat. The `+` on the workspace tabs and the Pulse Agent rail button lead here.
 */
export const Launcher = ({
  workspaces,
  loadedNodes,
  onWorkspaceContextRequest,
  onEnterChat,
  onOpenSession,
  onOpenAllChats,
  onOpenWorkspace,
  onCreateWorkspace,
}: Props) => {
  const { t } = useI18n();
  const broker = useChatTargetBroker();
  const notifyChatDelivery = useChatDeliveryNotifier();
  const { recentWorkspaces, summaries, recentChats } = useLauncherData(workspaces, loadedNodes, t('chat.scope.global'));

  // Create the new session before entering the page, so the page opens on
  // it. Entering first showed the scope's previous chat until the swap.
  const ask = async (text: string, scope: AgentScope, label: string, context?: AgentRequestContext) => {
    const created: AgentNewSessionResult = await window.canvasWorkspace.agent.newSession({ scope })
      .catch((error: unknown) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    if (!created.ok || !created.activeSessionId) {
      notifyChatDelivery({ status: 'failed', target: null, error: created.error }, label);
      return false;
    }
    const target = createChatPageSessionTarget(scope, created.activeSessionId, label);
    onEnterChat(target);
    const receipt = await deliverWhenReady(broker, target, { text, nodes: [], context });
    if (receipt.status !== 'delivered') notifyChatDelivery(receipt, label);
    return receipt.status === 'delivered' || receipt.status === 'queued';
  };

  const openChat = (chat: RecentChat) => {
    onOpenSession(scopeFromSessionStoreId(chat.storeId), chat.session.sessionId, chat.scopeName);
  };

  return (
    <div className="launcher">
      <div className="launcher__inner">
        <h1 className="launcher__title">{t('launcher.title')}</h1>
        <LauncherComposer
          workspaces={workspaces}
          loadedNodes={loadedNodes}
          onWorkspaceContextRequest={onWorkspaceContextRequest}
          onAsk={ask}
        />
        <RecentWorkspaces
          workspaces={recentWorkspaces}
          summaries={summaries}
          onOpenWorkspace={onOpenWorkspace}
          onCreateWorkspace={onCreateWorkspace}
        />
        <RecentChats chats={recentChats} onOpenChat={openChat} onOpenAll={onOpenAllChats} />
      </div>
    </div>
  );
};
