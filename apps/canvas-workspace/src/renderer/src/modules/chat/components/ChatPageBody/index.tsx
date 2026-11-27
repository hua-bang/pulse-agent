import './index.css';
import { ChatView } from '../ChatView';
import { PeerStreamBridge } from '../ChatPanel/PeerStreamBridge';
import { SharedChatRoomBar } from '../ChatPanel/SharedChatRoomBar';
import { useSharedChatRoom } from '../ChatPanel/hooks/useSharedChatRoom';
import { ChatPageRail, ChatPageTopbar } from './ChatPageNavigationChrome';
import type { ChatPageBodyProps } from './types';
import { useChatPageBodyController } from './useChatPageBodyController';

export type { ChatPageBodyProps } from './types';

export const ChatPageBody = (props: ChatPageBodyProps) => {
  const controller = useChatPageBodyController(props);
  const { viewProps, chatRoom } = controller;
  const { workspaceId, conversationKey, messages, loading, streamingTools } = viewProps.thread;
  const sharedRoom = useSharedChatRoom({
    workspaceId,
    conversationId: conversationKey ?? '',
    messages,
    streamingTools,
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
    <div className="chat-page">
      {controller.showRail && (
        <ChatPageRail collapsed={controller.railCollapsed} rail={controller.sessionRail} />
      )}
      <div className="chat-page-main">
        <ChatPageTopbar {...controller.topbar} />
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
            composerAccessory: (
              <SharedChatRoomBar
                active={sharedRoom.chatRoomActive}
                typingPeers={sharedRoom.typingPeers}
                noteOnly={sharedRoom.noteOnly}
                onToggleNoteOnly={sharedRoom.toggleNoteOnly}
              />
            ),
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
                  onNewBranch={viewProps.chrome.onNewSession}
                  onPeerStreamFinished={chatRoom.reloadSession}
                />
              </>
            ),
          }}
        />
      </div>
    </div>
  );
};
