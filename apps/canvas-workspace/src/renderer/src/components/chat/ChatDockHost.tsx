/**
 * Shell-level host for the global chat surface. Decides — from the dock open
 * state and the current route — whether the surface is a right-side dock, the
 * full-screen focus page, or hidden, and sizes its wrapper accordingly. The
 * surface itself is always mounted so the conversation never tears down.
 */

import { useChatDock } from './ChatDockContext';
import { ChatSurface, type ChatSurfaceProps } from './ChatSurface';
import './ChatDock.css';

type ChatDockHostProps = Omit<ChatSurfaceProps, 'mode' | 'visible'> & {
  /** True when the /chat focus route is active. */
  isChatRoute: boolean;
};

export const ChatDockHost = ({ isChatRoute, ...surfaceProps }: ChatDockHostProps) => {
  const { dockOpen, dockWidth } = useChatDock();

  const mode: 'dock' | 'page' = isChatRoute ? 'page' : 'dock';
  const visible = dockOpen || isChatRoute;

  const className = [
    'chat-dock-host',
    `chat-dock-host--${mode}`,
    visible ? '' : 'chat-dock-host--hidden',
  ].filter(Boolean).join(' ');

  const style = mode === 'dock' && visible ? { width: dockWidth } : undefined;

  return (
    <div className={className} style={style}>
      <ChatSurface mode={mode} visible={visible} {...surfaceProps} />
    </div>
  );
};
