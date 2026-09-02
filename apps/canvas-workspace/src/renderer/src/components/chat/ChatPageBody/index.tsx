import './index.css';
import { ChatView } from '../ChatView';
import { ChatPageRail, ChatPageTopbar } from './ChatPageNavigationChrome';
import type { ChatPageBodyProps } from './types';
import { useChatPageBodyController } from './useChatPageBodyController';

export type { ChatPageBodyProps } from './types';

export const ChatPageBody = (props: ChatPageBodyProps) => {
  const controller = useChatPageBodyController(props);
  return (
    <div className="chat-page">
      {controller.showRail && (
        <ChatPageRail collapsed={controller.railCollapsed} rail={controller.sessionRail} />
      )}
      <div className="chat-page-main">
        <ChatPageTopbar {...controller.topbar} />
        <ChatView {...controller.viewProps} />
      </div>
    </div>
  );
};
