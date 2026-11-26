import './index.css';
import { ChatView } from '../ChatView';
import { PeerStreamBridge } from './PeerStreamBridge';
import type { ChatPanelProps } from './types';
import { useChatPanelController } from './useChatPanelController';

export const ChatPanel = (props: ChatPanelProps) => {
  const viewProps = useChatPanelController(props);
  const { workspaceId, conversationKey, messages, loading } = viewProps.thread;
  return (
    <ChatView
      {...viewProps}
      chrome={{
        ...viewProps.chrome,
        banner: (
          <>
            {viewProps.chrome.banner}
            <PeerStreamBridge
              workspaceId={workspaceId}
              conversationId={conversationKey ?? ''}
              messages={messages}
              loading={loading}
              onNewBranch={viewProps.chrome.onNewSession}
            />
          </>
        ),
      }}
    />
  );
};
