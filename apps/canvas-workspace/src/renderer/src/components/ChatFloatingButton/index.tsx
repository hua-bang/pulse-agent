import './index.css';
import { AppLogoIcon } from '../icons';

interface ChatFloatingButtonProps {
  active?: boolean;
  title: string;
  ariaLabel?: string;
  className?: string;
  onClick: () => void;
}

export const ChatFloatingButton = ({
  active,
  title,
  ariaLabel,
  className,
  onClick,
}: ChatFloatingButtonProps) => (
  <button
    type="button"
    className={[
      'chat-floating-button',
      active ? 'chat-floating-button--active' : '',
      className ?? '',
    ].filter(Boolean).join(' ')}
    onMouseDown={(event) => event.stopPropagation()}
    onClick={(event) => {
      event.stopPropagation();
      onClick();
    }}
    title={title}
    aria-label={ariaLabel ?? title}
    aria-pressed={active}
  >
    <AppLogoIcon size={22} />
  </button>
);
