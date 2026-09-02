import './index.css';
import { ChatView } from '../ChatView';
import type { ChatPanelProps } from './types';
import { useChatPanelController } from './useChatPanelController';

export const ChatPanel = (props: ChatPanelProps) => {
  const viewProps = useChatPanelController(props);
  return <ChatView {...viewProps} />;
};
