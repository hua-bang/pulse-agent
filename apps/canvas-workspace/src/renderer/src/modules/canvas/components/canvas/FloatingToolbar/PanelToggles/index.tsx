import { AppLogoIcon, BookmarkIcon } from '../../../../../../components/icons';
import { useI18n } from '../../../../../../i18n';

interface Props {
  chatPanelOpen?: boolean;
  onChatToggle?: () => void;
  referenceDrawerOpen?: boolean;
  onReferenceToggle?: () => void;
}

const Toggle = ({
  active,
  label,
  onToggle,
  children,
}: {
  active?: boolean;
  label: string;
  onToggle: () => void;
  children: JSX.Element;
}) => (
  <>
    <div className="toolbar-group">
      <button
        className={`toolbar-btn${active ? ' toolbar-btn--active' : ''}`}
        onClick={onToggle}
        title={label}
        aria-label={label}
        aria-pressed={active}
      >
        {children}
      </button>
    </div>
    <div className="toolbar-divider" />
  </>
);

export const PanelToggles = ({
  chatPanelOpen,
  onChatToggle,
  referenceDrawerOpen,
  onReferenceToggle,
}: Props) => {
  const { t } = useI18n();

  return (
    <>
      {onChatToggle && (
        <Toggle
          active={chatPanelOpen}
          label={t('canvas.toolbar.toggleChat')}
          onToggle={onChatToggle}
        >
          <AppLogoIcon size={18} />
        </Toggle>
      )}
      {onReferenceToggle && (
        <Toggle
          active={referenceDrawerOpen}
          label={t('canvas.toolbar.toggleReference')}
          onToggle={onReferenceToggle}
        >
          <BookmarkIcon size={18} />
        </Toggle>
      )}
    </>
  );
};
