import { useI18n } from '../../i18n';
import { ChatFloatingButton } from '../ChatFloatingButton';
import { useRightDock, useRightDockState } from '.';
import { isDockChatVisible } from './dock-visibility';

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
      active={isDockChatVisible(state)}
      className="app-global-chat-launcher"
      onClick={dock.toggleChat}
      title={t('canvas.toolbar.toggleChat')}
      ariaLabel={t('canvas.toolbar.toggleChat')}
    />
  );
};
