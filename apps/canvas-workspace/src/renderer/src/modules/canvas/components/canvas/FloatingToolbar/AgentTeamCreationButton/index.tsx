import { useI18n } from '../../../../../../i18n';

export const AgentTeamCreationButton = ({ onCreate }: { onCreate: () => void }) => {
  const { t } = useI18n();
  return (
    <button
      className="toolbar-btn toolbar-btn--create"
      onClick={onCreate}
      aria-label={t('canvas.toolbar.addAgentTeam')}
      data-tooltip={t('canvas.toolbar.team')}
    >
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <rect x="2.5" y="3" width="13" height="12" rx="2" stroke="currentColor" strokeWidth="1.25" />
        <path d="M5.5 6.5h7M5.5 9h7M5.5 11.5h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        <circle cx="13" cy="12" r="2.3" fill="var(--surface)" stroke="currentColor" strokeWidth="1.15" />
        <path d="M13 10.8v2.4M11.8 12h2.4" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
      </svg>
      <span className="toolbar-btn-label">{t('canvas.toolbar.team')}</span>
    </button>
  );
};
