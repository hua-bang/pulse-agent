import { AGENT_REGISTRY } from '../../config/agentRegistry';
import { AgentIcon } from './AgentIcon';
import { truncatePath } from './utils/terminal';
import { useI18n } from '../../i18n';

interface AgentRestartProps {
  agentType: string;
  cwd?: string;
  prompt?: string;
  cliSessionId?: string;
  codexSessionId?: string;
  onRestart: () => void;
  onEdit: () => void;
}

const FolderGlyph = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path
      d="M2 4.5A1.5 1.5 0 013.5 3H6l1.5 1.5h5A1.5 1.5 0 0114 6v5.5a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 11.5v-7z"
      stroke="currentColor"
      strokeWidth="1.3"
    />
  </svg>
);

const ChatGlyph = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path
      d="M2.5 4.5A1.5 1.5 0 014 3h8a1.5 1.5 0 011.5 1.5v5A1.5 1.5 0 0112 11H6.5L4 13.2V11A1.5 1.5 0 012.5 9.5v-5z"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinejoin="round"
    />
  </svg>
);

const CheckGlyph = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.2" />
    <path
      d="M5 8.2l2.1 2L11 6.5"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const WarningGlyph = () => (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path
      d="M7.1 2.5L1.5 12.5A1 1 0 002.4 14h11.2a1 1 0 00.9-1.5L8.9 2.5a1 1 0 00-1.8 0z"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinejoin="round"
    />
    <path d="M8 6v3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    <circle cx="8" cy="11.5" r="0.7" fill="currentColor" />
  </svg>
);

const PlayGlyph = () => (
  <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M4 3l9 5-9 5V3z" fill="currentColor" />
  </svg>
);

const PencilGlyph = () => (
  <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path
      d="M11 2.5l2.5 2.5L5 13.5H2.5V11L11 2.5z"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinejoin="round"
    />
  </svg>
);

export const AgentRestart = ({
  agentType,
  cwd,
  prompt,
  cliSessionId,
  codexSessionId,
  onRestart,
  onEdit,
}: AgentRestartProps) => {
  const { t } = useI18n();
  const agentDef = AGENT_REGISTRY.find((a) => a.id === agentType);
  const cwdDisplay = cwd ? truncatePath(cwd, 36) : 'Working Directory';
  const hasPrompt = !!(prompt && prompt.trim().length > 0);
  const promptPreview = hasPrompt ? t('agent.promptSaved') : t('agent.promptNotProvided');
  // Only offer "resume" when the node has a stable CLI conversation id.
  // Falling back to Codex `--last` can attach this node to another agent.
  const canResume = agentType === 'claude-code'
    ? !!cliSessionId
    : agentType === 'codex'
      ? !!codexSessionId
      : false;
  const restartLabel = canResume ? t('agent.resumeSession') : t('agent.restartSession');
  const restartTitle = canResume
    ? `Resume the previous ${agentDef?.label ?? 'agent'} conversation`
    : 'Restart with saved configuration';
  const warningText = canResume
    ? t('agent.resumeWarning')
    : t('agent.restartWarning');

  return (
    <div className="agent-body-wrap agent-body-wrap--restart">
      <div className="agent-card">
        <div className="agent-card-body">
          <div className="agent-section-title">{t('agent.savedConfigTitle')}</div>

          <div className="agent-saved-list">
            <div className="agent-saved-row" title={agentDef?.label ?? agentType}>
              <span className="agent-saved-row-left">
                <AgentIcon id={agentType} size={16} />
                <span className="agent-saved-row-label">
                  {agentDef?.label ?? 'Coding Agent'}
                </span>
              </span>
              <span className="agent-saved-row-check"><CheckGlyph /></span>
            </div>

            <div className="agent-saved-row" title={cwd ?? ''}>
              <span className="agent-saved-row-left">
                <FolderGlyph />
                <span className="agent-saved-row-label agent-saved-row-label--mono">
                  {cwdDisplay}
                </span>
              </span>
              <span className="agent-saved-row-check"><CheckGlyph /></span>
            </div>

            <div className="agent-saved-row" title={prompt ?? ''}>
              <span className="agent-saved-row-left">
                <ChatGlyph />
                <span className="agent-saved-row-label">Initial Prompt</span>
              </span>
              <span className="agent-saved-row-meta">{promptPreview}</span>
            </div>
          </div>

          <div className="agent-warning">
            <span className="agent-warning-icon"><WarningGlyph /></span>
            <span className="agent-warning-text">{warningText}</span>
          </div>
        </div>

        <div className="agent-card-footer agent-card-footer--restart">
          <button
            type="button"
            className="agent-primary-btn"
            onClick={onRestart}
            title={restartTitle}
          >
            <PlayGlyph />
            {restartLabel}
          </button>
          {!canResume && (
            <button
              type="button"
              className="agent-secondary-btn"
              onClick={onEdit}
              title={t('agent.editParams')}
            >
              <PencilGlyph />
              {t('agent.editParams')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
