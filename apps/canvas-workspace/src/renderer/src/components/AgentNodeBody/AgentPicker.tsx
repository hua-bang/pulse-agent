import type { ReactNode } from 'react';
import { AGENT_REGISTRY, type AgentDef } from '../../config/agentRegistry';
import { AgentIcon } from './AgentIcon';
import { truncatePath } from './utils/terminal';

interface AgentPickerProps {
  selectedAgent: string;
  cwdInput: string;
  promptInput: string;
  dangerousMode: boolean;
  rootFolder?: string;
  recentCwds: string[];
  variant?: 'default' | 'team-lead';
  teamLeadBriefSlot?: ReactNode;
  /** Optional Back button used when entering Setup from the Restart view. */
  onBack?: () => void;
  onAgentChange: (id: string) => void;
  onCwdChange: (value: string) => void;
  onPromptChange: (value: string) => void;
  onDangerousModeChange: (value: boolean) => void;
  onPickFolder: () => void;
  onLaunch: () => void;
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

export const AgentPicker = ({
  selectedAgent,
  cwdInput,
  promptInput,
  dangerousMode,
  rootFolder,
  recentCwds,
  variant = 'default',
  teamLeadBriefSlot,
  onBack,
  onAgentChange,
  onCwdChange,
  onPromptChange,
  onDangerousModeChange,
  onPickFolder,
  onLaunch,
}: AgentPickerProps) => {
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
  const startTitle = `Start ${agentDef?.label ?? 'agent'}  —  ${previewCmd}${effectiveDangerousMode && supportsDangerous ? ` ${dangerousFlag}` : ''
    }${effectiveCwd ? ` in ${effectiveCwd}` : ''}`;

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
              ← 返回
            </button>
          </div>
        )}

        <div className="agent-card-body">
          <div className="agent-tabs" role="tablist" aria-label="Coding agent">
            {AGENT_REGISTRY.map((a: AgentDef) => (
              <button
                key={a.id}
                type="button"
                role="tab"
                aria-selected={selectedAgent === a.id}
                className={`agent-tab${selectedAgent === a.id ? ' agent-tab--active' : ''
                  }`}
                onClick={() => onAgentChange(a.id)}
                title={`${a.label} — ${a.description}`}
              >
                <AgentIcon id={a.id} size={16} />
                <span>{a.label}</span>
              </button>
            ))}
          </div>

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
                      if (e.key === 'Enter') {
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
                  placeholder="请输入初始提示..."
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
                      跳过权限确认 <code>{dangerousFlag}</code>
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
            onClick={onLaunch}
            title={startTitle}
          >
            <PlayGlyph />
            {isTeamLead ? 'Start lead' : '初始化'}
          </button>
          </div>
        )}
      </div>
    </div>
  );
};
