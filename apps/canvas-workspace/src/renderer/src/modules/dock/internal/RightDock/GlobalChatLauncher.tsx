import { useI18n } from '../../../../i18n';
import { formatShortcutId } from '../../../../shortcuts/registry';
import { ChatFloatingButton } from '../../../chat/floating';
import { useRightDock, useRightDockState } from '.';
import { isDockChatVisible } from './state/dock-visibility';

interface GlobalChatLauncherProps {
  visible: boolean;
}

/** Route-level launcher for pages that do not own Canvas bottom chrome. */
export const GlobalChatLauncher = ({ visible }: GlobalChatLauncherProps) => {
  const { t } = useI18n();
  const dock = useRightDock();
  const state = useRightDockState();

  const chatVisible = isDockChatVisible(state);
  if (!visible || chatVisible) return null;

  const label = `${t('canvas.toolbar.toggleChat')} (${formatShortcutId('canvas.toggleChatPanel')})`;

  return (
    <ChatFloatingButton
      active={false}
      className="app-global-chat-launcher"
      onClick={dock.toggleChat}
      title={label}
      ariaLabel={label}
    />
  );
};
