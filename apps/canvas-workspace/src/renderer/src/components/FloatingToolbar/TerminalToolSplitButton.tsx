import { useI18n } from '../../i18n';

interface TerminalToolSplitButtonProps {
  open: boolean;
  showAdd: boolean;
  onToggle: () => void;
  onNewTerminal: () => void;
}

export const TerminalToolSplitButton = ({
  open,
  showAdd,
  onToggle,
  onNewTerminal,
}: TerminalToolSplitButtonProps) => {
  const { t } = useI18n();
  const toggleLabel = open ? t('canvas.toolbar.hideTerminal') : t('canvas.toolbar.showTerminal');

  return (
    <div className={[
      'terminal-tool-split',
      open ? 'terminal-tool-split--active' : '',
      showAdd ? 'terminal-tool-split--with-add' : '',
    ].filter(Boolean).join(' ')}>
      <button
        className={`toolbar-btn toolbar-btn--create terminal-tool-main${open ? ' toolbar-btn--active' : ''}`}
        onClick={onToggle}
        aria-label={toggleLabel}
        title={toggleLabel}
        data-tooltip={t('canvas.toolbar.terminal')}
        aria-pressed={open}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
          <rect
            x="2.5" y="3" width="13" height="12" rx="2"
            stroke="currentColor" strokeWidth="1.3"
          />
          <path
            d="M5.5 8l2 1.5-2 1.5M9 11h3.5"
            stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"
          />
        </svg>
        <span className="toolbar-btn-label">{t('canvas.toolbar.terminal')}</span>
      </button>
      {showAdd && (
        <button
          className="toolbar-btn terminal-tool-add"
          onClick={onNewTerminal}
          aria-label={t('canvas.toolbar.newTerminal')}
          title={t('canvas.toolbar.newTerminal')}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path
              d="M7 3.2v7.6M3.2 7h7.6"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      )}
    </div>
  );
};
