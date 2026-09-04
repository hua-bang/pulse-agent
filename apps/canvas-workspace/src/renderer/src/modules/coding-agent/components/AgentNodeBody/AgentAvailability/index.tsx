import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import './index.css';
import { AGENT_REGISTRY, type AgentDef } from '../../../../../config/agentRegistry';
import { useI18n } from '../../../../../i18n';
import { AgentIcon } from '../AgentIcon';

type CommandStatus = 'checking' | 'available' | 'missing' | 'unknown';

interface AgentInstallGuide {
  primaryCommand: string;
  alternateCommands?: string[];
  verifyCommand: string;
  docUrl?: string;
}

const INSTALL_GUIDES: Record<string, AgentInstallGuide> = {
  'claude-code': {
    primaryCommand: 'curl -fsSL https://claude.ai/install.sh | bash',
    alternateCommands: ['brew install --cask claude-code', 'winget install Anthropic.ClaudeCode'],
    verifyCommand: 'claude',
    docUrl: 'https://code.claude.com/docs/quickstart',
  },
  codex: {
    primaryCommand: 'curl -fsSL https://chatgpt.com/codex/install.sh | sh',
    alternateCommands: ['npm install -g @openai/codex', 'brew install --cask codex'],
    verifyCommand: 'codex',
    docUrl: 'https://developers.openai.com/codex/quickstart',
  },
  pi: {
    primaryCommand: 'curl -fsSL https://pi.dev/install.sh | sh',
    alternateCommands: ['npm install -g @mariozechner/pi-coding-agent'],
    verifyCommand: 'pi',
    docUrl: 'https://github.com/earendil-works/pi',
  },
};

interface Props {
  selectedAgent: string;
  launchErrorCommand?: string | null;
  onAgentChange: (id: string) => void;
  onStartAnyway: () => void;
}

export const AgentAvailability = ({
  selectedAgent,
  launchErrorCommand,
  onAgentChange,
  onStartAnyway,
}: Props) => {
  const { t } = useI18n();
  const [statuses, setStatuses] = useState<Record<string, CommandStatus>>(() =>
    Object.fromEntries(AGENT_REGISTRY.map((agent) => [agent.id, 'checking'])),
  );
  const [copiedCommand, setCopiedCommand] = useState<string | null>(null);
  const agent = AGENT_REGISTRY.find((item) => item.id === selectedAgent);
  const guide = INSTALL_GUIDES[selectedAgent];
  const commands = useMemo(
    () => guide ? [guide.primaryCommand, ...(guide.alternateCommands ?? [])] : [],
    [guide],
  );
  const showGuide = !!guide && (statuses[selectedAgent] === 'missing' || !!launchErrorCommand);

  useEffect(() => {
    const checker = window.canvasWorkspace?.pty?.checkCommand;
    if (!checker) {
      setStatuses(Object.fromEntries(AGENT_REGISTRY.map((item) => [item.id, 'unknown'])));
      return undefined;
    }
    let cancelled = false;
    for (const item of AGENT_REGISTRY) {
      void checker(item.command).then((result) => {
        if (!cancelled) {
          setStatuses((current) => ({
            ...current,
            [item.id]: result.ok && result.available ? 'available' : 'missing',
          }));
        }
      }).catch(() => {
        if (!cancelled) setStatuses((current) => ({ ...current, [item.id]: 'missing' }));
      });
    }
    return () => { cancelled = true; };
  }, []);

  const copyCommand = (command: string) => {
    const clipboard = navigator.clipboard;
    if (!clipboard?.writeText) {
      setCopiedCommand(null);
      return;
    }
    void clipboard.writeText(command).then(
      () => setCopiedCommand(command),
      () => setCopiedCommand(null),
    );
  };

  return (
    <>
      <div className="agent-tabs" role="tablist" aria-label="Coding agent" style={{ '--agent-tab-count': AGENT_REGISTRY.length } as CSSProperties}>
        {AGENT_REGISTRY.map((item: AgentDef) => {
          const missing = statuses[item.id] === 'missing';
          const tooltip = missing
            ? t('agent.cliInstallTooltip', { agent: item.label, command: item.command })
            : `${item.label} — ${item.description}`;
          return (
            <span key={item.id} className={`agent-tab-shell${missing ? ' agent-tab-shell--disabled' : ''}`} title={tooltip}>
              <button
                type="button"
                role="tab"
                aria-selected={selectedAgent === item.id}
                className={`agent-tab${selectedAgent === item.id ? ' agent-tab--active' : ''}${missing ? ' agent-tab--disabled' : ''}`}
                onClick={() => { if (!missing) onAgentChange(item.id); }}
                disabled={missing}
                aria-label={tooltip}
              >
                <span className="agent-tab__main"><AgentIcon id={item.id} size={16} /><span className="agent-tab__label">{item.label}</span></span>
              </button>
            </span>
          );
        })}
      </div>

      {launchErrorCommand && (
        <div className="agent-cli-warning" role="status">
          <strong>{t('agent.cliMissingTitle', { command: launchErrorCommand })}</strong>
          <span>{t('agent.cliMissingDescription')}</span>
          <button type="button" className="agent-text-link" onClick={onStartAnyway}>{t('agent.startAnyway')}</button>
        </div>
      )}

      {showGuide && guide && agent && (
        <div className="agent-install-guide">
          <div className="agent-install-guide__header">
            <strong>{t('agent.installGuideTitle', { agent: agent.label })}</strong>
            {guide.docUrl && <button type="button" className="agent-text-link" onClick={() => void window.canvasWorkspace?.shell.openExternal(guide.docUrl!)}>{t('agent.installDocs')}</button>}
          </div>
          <div className="agent-install-guide__commands">
            {commands.map((command, index) => (
              <div className="agent-install-command" key={command}>
                <span>{index === 0 ? t('agent.installRecommended') : t('agent.installAlternative')}</span>
                <code>{command}</code>
                <button type="button" className="agent-install-copy" onClick={() => copyCommand(command)}>{copiedCommand === command ? t('agent.installCopied') : t('agent.installCopy')}</button>
              </div>
            ))}
            <div className="agent-install-command agent-install-command--verify">
              <span>{t('agent.installVerify')}</span><code>{guide.verifyCommand}</code>
              <button type="button" className="agent-install-copy" onClick={() => copyCommand(guide.verifyCommand)}>{copiedCommand === guide.verifyCommand ? t('agent.installCopied') : t('agent.installCopy')}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
