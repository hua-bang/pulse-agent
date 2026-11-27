import './index.css';
import { ChatView } from '../ChatView';
import { PeerStreamBridge } from './PeerStreamBridge';
import { useSharedChatRoom } from './hooks/useSharedChatRoom';
import type { ChatPanelProps } from './types';
import { useChatPanelController } from './useChatPanelController';

export const ChatPanel = (props: ChatPanelProps) => {
  const { chatRoom, ...viewProps } = useChatPanelController(props);
  const { workspaceId, conversationKey, messages, loading } = viewProps.thread;
  const sharedRoom = useSharedChatRoom({
    workspaceId,
    conversationId: conversationKey ?? '',
    messages,
    loading,
    input: viewProps.composer.input,
    mentionOpen: viewProps.composer.mentionOpen,
    onSubmit: viewProps.composer.onSubmit,
    onKeyDown: viewProps.composer.onKeyDown,
    sendMessage: chatRoom.sendMessage,
    clearInput: chatRoom.clearInput,
    reloadSession: chatRoom.reloadSession,
  });

  return (
    <ChatView
      {...viewProps}
      thread={{
        ...viewProps.thread,
        messages: sharedRoom.displayMessages,
      }}
      composer={{
        ...viewProps.composer,
        onSubmit: sharedRoom.onSubmit,
        onKeyDown: sharedRoom.onKeyDown,
      }}
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
              chatRoomActive={sharedRoom.chatRoomActive}
              roomActiveTurn={sharedRoom.activeTurn}
              roomQueue={sharedRoom.queue}
              onCancelQueued={sharedRoom.cancelQueued}
              onNewBranch={viewProps.chrome.onNewSession}
              onPeerStreamFinished={chatRoom.reloadSession}
            />
          </>
        ),
      }}
    />
  );
};
