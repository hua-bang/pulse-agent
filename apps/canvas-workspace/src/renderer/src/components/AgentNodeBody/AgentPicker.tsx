import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AGENT_REGISTRY, type AgentDef } from '../../config/agentRegistry';
import { AgentIcon } from './AgentIcon';
import { truncatePath } from './utils/terminal';
import { isImeComposing } from '../../utils/ime';
import { useI18n } from '../../i18n';

interface AgentPickerProps {
  selectedAgent: string;
  cwdInput: string;
  promptInput: string;
  dangerousMode: boolean;
  rootFolder?: string;
  recentCwds: string[];
  variant?: 'default' | 'team-lead';
  launchErrorCommand?: string | null;
  teamLeadBriefSlot?: ReactNode;
  /** Optional Back button used when entering Setup from the Restart view. */
  onBack?: () => void;
  onAgentChange: (id: string) => void;
  onCwdChange: (value: string) => void;
  onPromptChange: (value: string) => void;
  onDangerousModeChange: (value: boolean) => void;
  onPickFolder: () => void;
  onLaunch: (options?: { skipPreflight?: boolean }) => void;
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

const ChatGlyph = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path
      d="M2.5 4.5A1.5 1.5 0 014 3h8a1.5 1.5 0 011.5 1.5v5A1.5 1.5 0 0112 11H6.5L4 13.2V11A1.5 1.5 0 012.5 9.5v-5z"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinejoin="round"
    />
  </svg>
);

const PlayGlyph = () => (
  <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M4 3l9 5-9 5V3z" fill="currentColor" />
  </svg>
);

type CommandStatus = 'checking' | 'available' | 'missing' | 'unknown';

interface AgentInstallGuide {
  primaryCommand: string;
  alternateCommands?: string[];
  verifyCommand: string;
  docUrl?: string;
}

const AGENT_INSTALL_GUIDES: Record<string, AgentInstallGuide> = {
  'claude-code': {
    primaryCommand: 'curl -fsSL https://claude.ai/install.sh | bash',
    alternateCommands: [
      'brew install --cask claude-code',
      'winget install Anthropic.ClaudeCode',
    ],
    verifyCommand: 'claude',
    docUrl: 'https://code.claude.com/docs/quickstart',
  },
  codex: {
    primaryCommand: 'curl -fsSL https://chatgpt.com/codex/install.sh | sh',
    alternateCommands: [
      'npm install -g @openai/codex',
      'brew install --cask codex',
    ],
    verifyCommand: 'codex',
    docUrl: 'https://developers.openai.com/codex/quickstart',
  },
};

export const AgentPicker = ({
  selectedAgent,
  cwdInput,
  promptInput,
  dangerousMode,
  rootFolder,
  recentCwds,
  variant = 'default',
  launchErrorCommand,
  teamLeadBriefSlot,
  onBack,
  onAgentChange,
  onCwdChange,
  onPromptChange,
  onDangerousModeChange,
  onPickFolder,
  onLaunch,
}: AgentPickerProps) => {
  const { t } = useI18n();
  const [commandStatusByAgent, setCommandStatusByAgent] = useState<Record<string, CommandStatus>>(() => {
    return Object.fromEntries(AGENT_REGISTRY.map((agent) => [agent.id, 'checking']));
  });
  const [copiedCommand, setCopiedCommand] = useState<string | null>(null);
  const agentDef = AGENT_REGISTRY.find((a: AgentDef) => a.id === selectedAgent);
  const effectiveCwd = cwdInput || rootFolder || '';
  const previewCmd = agentDef?.command ?? 'agent';
  const visibleRecents = recentCwds.filter((p) => p !== cwdInput).slice(0, 3);
  const isTeamLead = variant === 'team-lead';
  const dangerousFlag =
    selectedAgent === 'claude-code'
      ? '--dangerously-skip-permissions'
      : selectedAgent === 'codex'
        ? '--dangerously-bypass-approvals-and-sandbox'
        : '';
  const supportsDangerous = dangerousFlag !== '';
  const effectiveDangerousMode = isTeamLead ? true : dangerousMode;
  const selectedCommandStatus = commandStatusByAgent[selectedAgent] ?? 'checking';
  const installGuide = AGENT_INSTALL_GUIDES[selectedAgent];
  const shouldShowInstallGuide = Boolean(installGuide && (selectedCommandStatus === 'missing' || launchErrorCommand));
  const startTitle = `Start ${agentDef?.label ?? 'agent'}  —  ${previewCmd}${effectiveDangerousMode && supportsDangerous ? ` ${dangerousFlag}` : ''
    }${effectiveCwd ? ` in ${effectiveCwd}` : ''}`;
  const allInstallCommands = useMemo(() => {
    if (!installGuide) return [];
    return [installGuide.primaryCommand, ...(installGuide.alternateCommands ?? [])];
  }, [installGuide]);
  useEffect(() => {
    const checker = window.canvasWorkspace?.pty?.checkCommand;
    if (!checker) {
      setCommandStatusByAgent(Object.fromEntries(
        AGENT_REGISTRY.map((agent) => [agent.id, 'unknown']),
      ));
      return;
    }

    let cancelled = false;
    for (const agent of AGENT_REGISTRY) {
      void checker(agent.command).then((result) => {
        if (cancelled) return;
        setCommandStatusByAgent((prev) => ({
          ...prev,
          [agent.id]: result.ok && result.available ? 'available' : 'missing',
        }));
      }).catch(() => {
        if (cancelled) return;
        setCommandStatusByAgent((prev) => ({
          ...prev,
          [agent.id]: 'missing',
        }));
      });
    }

    return () => {
      cancelled = true;
    };
  }, []);

  const copyCommand = (command: string) => {
    const clipboard = navigator.clipboard;
    if (!clipboard?.writeText) {
      setCopiedCommand(null);
      return;
    }
    void clipboard.writeText(command).then(() => {
      setCopiedCommand(command);
    }).catch(() => {
      setCopiedCommand(null);
    });
  };

  const openInstallDocs = (url: string) => {
    void window.canvasWorkspace?.shell.openExternal(url);
  };

  return (
    <div className="agent-body-wrap agent-body-wrap--setup">
      <div className="agent-card">
        {onBack && (
          <div className="agent-card-back">
            <button
              type="button"
              className="agent-text-link"
              onClick={onBack}
              title="Back to saved configuration"
            >
              ← {t('agent.back')}
            </button>
          </div>
        )}

        <div className="agent-card-body">
          <div className="agent-tabs" role="tablist" aria-label="Coding agent">
            {AGENT_REGISTRY.map((a: AgentDef) => {
              const commandStatus = commandStatusByAgent[a.id] ?? 'checking';
              const isMissing = commandStatus === 'missing';
              const tooltip = isMissing
                ? t('agent.cliInstallTooltip', { agent: a.label, command: a.command })
                : `${a.label} — ${a.description}`;

              return (
                <span
                  key={a.id}
                  className={`agent-tab-shell${isMissing ? ' agent-tab-shell--disabled' : ''}`}
                  title={tooltip}
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={selectedAgent === a.id}
                    className={`agent-tab${selectedAgent === a.id ? ' agent-tab--active' : ''
                      }${isMissing ? ' agent-tab--disabled' : ''}`}
                    onClick={() => {
                      if (!isMissing) onAgentChange(a.id);
                    }}
                    disabled={isMissing}
                    aria-label={tooltip}
                  >
                    <span className="agent-tab__main">
                      <AgentIcon id={a.id} size={16} />
                      <span className="agent-tab__label">{a.label}</span>
                    </span>
                  </button>
                </span>
              );
            })}
          </div>

          {launchErrorCommand && (
            <div className="agent-cli-warning" role="status">
              <strong>{t('agent.cliMissingTitle', { command: launchErrorCommand })}</strong>
              <span>{t('agent.cliMissingDescription')}</span>
              <button
                type="button"
                className="agent-text-link"
                onClick={() => onLaunch({ skipPreflight: true })}
              >
                {t('agent.startAnyway')}
              </button>
            </div>
          )}

          {shouldShowInstallGuide && installGuide && agentDef && (
            <div className="agent-install-guide">
              <div className="agent-install-guide__header">
                <strong>{t('agent.installGuideTitle', { agent: agentDef.label })}</strong>
                {installGuide.docUrl ? (
                  <button
                    type="button"
                    className="agent-text-link"
                    onClick={() => openInstallDocs(installGuide.docUrl!)}
                  >
                    {t('agent.installDocs')}
                  </button>
                ) : null}
              </div>
              <div className="agent-install-guide__commands">
                {allInstallCommands.map((command, index) => (
                  <div className="agent-install-command" key={command}>
                    <span>{index === 0 ? t('agent.installRecommended') : t('agent.installAlternative')}</span>
                    <code>{command}</code>
                    <button
                      type="button"
                      className="agent-install-copy"
                      onClick={() => copyCommand(command)}
                    >
                      {copiedCommand === command ? t('agent.installCopied') : t('agent.installCopy')}
                    </button>
                  </div>
                ))}
                <div className="agent-install-command agent-install-command--verify">
                  <span>{t('agent.installVerify')}</span>
                  <code>{installGuide.verifyCommand}</code>
                  <button
                    type="button"
                    className="agent-install-copy"
                    onClick={() => copyCommand(installGuide.verifyCommand)}
                  >
                    {copiedCommand === installGuide.verifyCommand ? t('agent.installCopied') : t('agent.installCopy')}
                  </button>
                </div>
              </div>
            </div>
          )}

          {isTeamLead ? (
            <>
              <div className="agent-team-lead-setup-summary">
                <div>
                  <span>Workspace</span>
                  <strong title={effectiveCwd || '~'}>{effectiveCwd ? truncatePath(effectiveCwd, 46) : '~'}</strong>
                </div>
                <div>
                  <span>Approvals</span>
                  <strong>Bypassed</strong>
                </div>
                <div>
                  <span>Prompt</span>
                  <strong>Brief Team Lead</strong>
                </div>
              </div>

              {teamLeadBriefSlot}
            </>
          ) : (
            <>
              <div className="agent-field">
                <div className="agent-field-label">
                  <FolderGlyph />
                  <span>Working Directory</span>
                </div>
                <div className="agent-dir-field">
                  <input
                    type="text"
                    className="agent-dir-input"
                    value={cwdInput}
                    onChange={(e) => onCwdChange(e.target.value)}
                    placeholder={rootFolder ? truncatePath(rootFolder, 36) : '~'}
                    title={
                      rootFolder
                        ? `Defaults to workspace root: ${rootFolder}`
                        : 'Defaults to your home directory'
                    }
                    spellCheck={false}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !isImeComposing(e)) {
                        e.preventDefault();
                        onLaunch();
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="agent-dir-icon"
                    onClick={onPickFolder}
                    title="Browse…"
                    aria-label="Browse for folder"
                  >
                    <FolderGlyph />
                  </button>
                </div>
                {visibleRecents.length > 0 && (
                  <div className="agent-recent">
                    <span className="agent-recent-label">Recent</span>
                    {visibleRecents.map((p) => (
                      <button
                        key={p}
                        type="button"
                        className="agent-recent-chip"
                        onClick={() => onCwdChange(p)}
                        title={p}
                      >
                        {truncatePath(p, 22)}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="agent-field">
                <div className="agent-field-label">
                  <ChatGlyph />
                  <span>Initial Prompt</span>
                </div>
                <textarea
                  className="agent-prompt-input"
                  value={promptInput}
                  onChange={(e) => onPromptChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      onLaunch();
                    }
                  }}
                  placeholder={t('agent.promptPlaceholder')}
                  spellCheck={false}
                  rows={3}
                />
              </div>

              {supportsDangerous && (
                <div className="agent-field">
                  <label className="agent-dangerous-toggle" title={`Adds \`${dangerousFlag}\` to the launch command`}>
                    <input
                      type="checkbox"
                      checked={dangerousMode}
                      onChange={(e) => onDangerousModeChange(e.target.checked)}
                    />
                    <span className="agent-dangerous-toggle-text">
                      {t('agent.skipPermissions')} <code>{dangerousFlag}</code>
                    </span>
                  </label>
                </div>
              )}
            </>
          )}
        </div>

        {(!isTeamLead || !teamLeadBriefSlot) && (
          <div className="agent-card-footer" style={{ border: 'none' }}>
          <button
            type="button"
            className="agent-primary-btn"
            style={{ opacity: 0.8 }}
            onClick={() => onLaunch()}
            title={startTitle}
          >
            <PlayGlyph />
            {isTeamLead ? 'Start lead' : t('agent.initialize')}
          </button>
          </div>
        )}
      </div>
    </div>
  );
};
