import type React from 'react';
import { AGENT_REGISTRY } from '../../config/agentRegistry';
import { AgentIcon } from './AgentIcon';
import { truncatePath } from './utils/terminal';
import { useI18n, type I18nKey } from '../../i18n';
import { MentionTriggerButton } from '../NodeMentionPicker/MentionTriggerButton';
import { NODE_MENTION_SHORTCUT } from '../NodeMentionPicker';

interface AgentTerminalProps {
  containerRef: React.RefObject<HTMLDivElement>;
  status: string;
  agentType: string;
  cwd?: string;
  /** True while the PTY + agent CLI are bootstrapping. Used to render a
   *  loading overlay on top of the otherwise-empty terminal so the user
   *  doesn't stare at a black panel during the 1–3s Claude / Codex
   *  startup window. */
  loading?: boolean;
  /** Opens the canvas node mention picker; omit to hide the trigger button. */
  onMention?: () => void;
}

const FolderGlyph = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path
      d="M2 4.5A1.5 1.5 0 013.5 3H6l1.5 1.5h5A1.5 1.5 0 0114 6v5.5a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 11.5v-7z"
      stroke="currentColor"
      strokeWidth="1.25"
    />
  </svg>
);

const STATUS_TEXT: Record<string, { loadKey: I18nKey; tone: 'running' | 'done' | 'error' }> = {
  running: { loadKey: 'agent.statusRunning', tone: 'running' },
  done: { loadKey: 'agent.statusExited', tone: 'done' },
  error: { loadKey: 'agent.statusError', tone: 'error' },
  idle: { loadKey: 'agent.statusIdle', tone: 'done' },
};

export const AgentTerminal = ({
  containerRef,
  status,
  agentType,
  cwd,
  loading = false,
  onMention,
}: AgentTerminalProps) => {
  const { t } = useI18n();
  const agentDef = AGENT_REGISTRY.find((a) => a.id === agentType);
  const statusInfo = STATUS_TEXT[status] ?? STATUS_TEXT.running;
  const displayCwd = cwd ? truncatePath(cwd, 32) : '—';
  const loadStripText = loading ? t('agent.statusStarting') : t(statusInfo.loadKey);
  const loadStripTone = loading ? 'running' : statusInfo.tone;

  return (
    <div className="agent-body-wrap agent-body-wrap--running">
      <div className="agent-card">
        <div className="agent-info-strip">
          <span className="agent-info-cell">
            <AgentIcon id={agentType} size={14} />
            <span className="agent-info-text">{agentDef?.label ?? agentType}</span>
          </span>
          <span className="agent-info-sep" aria-hidden="true" />
          <span className="agent-info-cell agent-info-cell--cwd" title={cwd ?? ''}>
            <FolderGlyph />
            <span className="agent-info-text agent-info-text--mono">{displayCwd}</span>
          </span>
          <span className="agent-info-sep" aria-hidden="true" />
          <span
            className={`agent-info-cell agent-info-load agent-info-load--${loadStripTone}${
              loading ? ' agent-info-load--pulsing' : ''
            }`}
          >
            <span className="agent-info-load-dot" />
            {loadStripText}
          </span>
        </div>

        <div className="agent-xterm-wrap">
          <div
            ref={containerRef}
            className="agent-xterm-container"
            onMouseDown={(e) => e.stopPropagation()}
            // Scrolling terminal output must not also pan the canvas underneath.
            onWheel={(e) => e.stopPropagation()}
          />
          {loading && (
            <div
              className={`agent-loading-overlay agent-loading-overlay--${agentType}`}
              role="status"
              aria-label={`Starting ${agentDef?.label ?? agentType}`}
            >
              <div className="agent-loading-mark" aria-hidden="true">
                <span className="agent-loading-halo agent-loading-halo--outer" />
                <span className="agent-loading-halo agent-loading-halo--inner" />
                <span className="agent-loading-icon">
                  <AgentIcon id={agentType} size={22} />
                </span>
              </div>
            </div>
          )}
          {onMention && !loading && (
            <MentionTriggerButton
              label={t('nodeMention.triggerLabel')}
              title={`${t('nodeMention.title')} · ${NODE_MENTION_SHORTCUT}`}
              onClick={onMention}
            />
          )}
        </div>
      </div>
    </div>
  );
};
