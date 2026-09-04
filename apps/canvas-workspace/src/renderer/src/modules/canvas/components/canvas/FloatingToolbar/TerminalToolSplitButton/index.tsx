import { NodeTypeIcon } from '../../../../../../components/icons';
import { useI18n } from '../../../../../../i18n';
import './index.css';

interface Props {
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
}: Props) => {
  const { t } = useI18n();
  const toggleLabel = open
    ? t('canvas.toolbar.hideTerminal')
    : t('canvas.toolbar.showTerminal');

  return (
    <div
      className={[
        'terminal-tool-split',
        open ? 'terminal-tool-split--active' : '',
        showAdd ? 'terminal-tool-split--with-add' : '',
      ].filter(Boolean).join(' ')}
    >
      <button
        className={`toolbar-btn toolbar-btn--create terminal-tool-main${open ? ' toolbar-btn--active' : ''}`}
        onClick={onToggle}
        aria-label={toggleLabel}
        title={toggleLabel}
        data-tooltip={t('canvas.toolbar.terminal')}
        aria-pressed={open}
      >
        <NodeTypeIcon type="terminal" size={18} />
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
