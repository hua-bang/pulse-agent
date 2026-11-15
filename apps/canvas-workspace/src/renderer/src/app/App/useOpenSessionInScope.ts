import { useCallback, useEffect } from 'react';
import type { useI18n } from '../../i18n';
import type { AgentScope } from '../../types';
import type { ChatTarget } from '../../shared/chatTarget';
import { onOpenChatSessionRequest } from '../../shared/appCommands';

interface Options {
  enterChatTarget: (target: ChatTarget | null) => void;
  t: ReturnType<typeof useI18n>['t'];
  workspaces: ReadonlyArray<{ id: string; name: string }>;
}

/**
 * Open one durable conversation in full-page Pulse AI, in the scope that owns
 * it. Completion toasts, scheduled runs, and the Cmd+K palette all use it.
 * The chat session helpers load on first use, so startup does not pay for
 * them.
 */
export const useOpenSessionInScope = ({ enterChatTarget, t, workspaces }: Options) => {
  const openSessionInScope = useCallback(async (
    scope: AgentScope,
    sessionId: string,
    scopeLabel: string,
  ) => {
    const { createChatPageSessionTarget } = await import('../../modules/chat/session');
    const label = scope.kind === 'workspace'
      ? workspaces.find(workspace => workspace.id === scope.workspaceId)?.name ?? scopeLabel
      : scope.kind === 'global' ? t('chat.scope.global') : scopeLabel;
    enterChatTarget(createChatPageSessionTarget(scope, sessionId, label));
  }, [enterChatTarget, t, workspaces]);

  useEffect(() => onOpenChatSessionRequest((request) => {
    void import('../../modules/chat/session').then(({ scopeFromSessionStoreId }) => (
      openSessionInScope(scopeFromSessionStoreId(request.storeId), request.sessionId, request.label)
    ));
  }), [openSessionInScope]);

  return openSessionInScope;
};
