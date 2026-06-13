import type { CanvasModelStatus } from '../../types';
import { QUICK_ACTIONS } from './constants';
import type { QuickAction } from './types';
import { AppLogoIcon } from '../icons';
import { useI18n } from '../../i18n';

function QuickActionIcon({ action }: { action: QuickAction }) {
  switch (action.key) {
    case 'summarize_canvas':
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M2.5 4h11M2.5 8h7.5M2.5 12h9" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
        </svg>
      );
    case 'analyze_relations':
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <circle cx="4" cy="8" r="1.7" stroke="currentColor" strokeWidth="1.25" />
          <circle cx="12" cy="4" r="1.7" stroke="currentColor" strokeWidth="1.25" />
          <circle cx="12" cy="12" r="1.7" stroke="currentColor" strokeWidth="1.25" />
          <path d="M5.6 7.4l4.8-2.6M5.6 8.6l4.8 2.6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      );
    case 'create_mindmap':
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <circle cx="4" cy="8" r="1.6" stroke="currentColor" strokeWidth="1.25" />
          <circle cx="12" cy="3.8" r="1.4" stroke="currentColor" strokeWidth="1.25" />
          <circle cx="12" cy="8" r="1.4" stroke="currentColor" strokeWidth="1.25" />
          <circle cx="12" cy="12.2" r="1.4" stroke="currentColor" strokeWidth="1.25" />
          <path d="M5.5 8l5-4M5.6 8h4.8M5.5 8l5 4" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
        </svg>
      );
    case 'organize_selection':
    default:
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.25" />
          <path d="M5 8.2l2 2 4-4.4" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
  }
}

interface ChatEmptyStateProps {
  selectedCount?: number;
  onQuickAction: (prompt: string, quickAction?: string) => void;
  /**
   * Current model status. When defined and `apiKeyPresent === false` we show
   * a banner nudging the user to configure a provider. Left undefined while
   * the status is still loading so the banner doesn't flash on mount.
   */
  modelStatus?: CanvasModelStatus;
  /** Called when the user clicks the "Configure" CTA in the banner. */
  onConfigureModel?: () => void;
}

export const ChatEmptyState = ({
  selectedCount = 0,
  onQuickAction,
  modelStatus,
  onConfigureModel,
}: ChatEmptyStateProps) => {
  const { t } = useI18n();
  const showConfigureBanner = modelStatus !== undefined && !modelStatus.apiKeyPresent;
  return (
    <div className="chat-empty-state">
      <div className="chat-empty-icon">
        <AppLogoIcon size={36} />
      </div>
      <div className="chat-empty-greeting">{t('chat.emptyGreeting')}</div>
      <div className="chat-quick-actions">
        {QUICK_ACTIONS.filter(action => !action.requiresSelection || selectedCount > 0).map(action => (
          <button
            key={action.key}
            className="chat-quick-action"
            onClick={() => onQuickAction(action.promptKey ? t(action.promptKey) : action.prompt, action.key)}
          >
            <span className="chat-quick-action-icon">
              <QuickActionIcon action={action} />
            </span>
            <span>{action.labelKey ? t(action.labelKey) : action.label}</span>
          </button>
        ))}
      </div>
      {showConfigureBanner && (
        <button
          type="button"
          className="chat-empty-configure-banner"
          onClick={onConfigureModel}
          aria-label={t('chat.configureModelAria')}
        >
          <span className="chat-empty-configure-icon" aria-hidden="true" />
          <span className="chat-empty-configure-text">
            <strong>{t('chat.configureModelTitle')}</strong>
            <span>{t('chat.configureModelDescription')}</span>
          </span>
          <span className="chat-empty-configure-cta">{t('chat.configureModelCta')}</span>
        </button>
      )}
    </div>
  );
};
