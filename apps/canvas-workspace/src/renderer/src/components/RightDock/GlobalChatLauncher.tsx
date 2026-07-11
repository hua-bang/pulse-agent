import { useI18n } from '../../i18n';
import { ChatFloatingButton } from '../ChatFloatingButton';
import { CHAT_TAB_ID } from './dock-store';
import { useRightDock, useRightDockState } from '.';

interface GlobalChatLauncherProps {
  visible: boolean;
}

/** Route-level launcher for pages that do not own Canvas bottom chrome. */
export const GlobalChatLauncher = ({ visible }: GlobalChatLauncherProps) => {
  const { t } = useI18n();
  const dock = useRightDock();
  const state = useRightDockState();

  if (!visible) return null;

  return (
    <ChatFloatingButton
      active={state.expanded && state.activeTabId === CHAT_TAB_ID}
      className="app-global-chat-launcher"
      onClick={dock.toggleChat}
      title={t('canvas.toolbar.toggleChat')}
      ariaLabel={t('canvas.toolbar.toggleChat')}
    />
  );
};
