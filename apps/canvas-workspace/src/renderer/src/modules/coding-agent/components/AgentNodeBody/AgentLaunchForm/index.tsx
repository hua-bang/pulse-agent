import { useRef, type ReactNode } from 'react';
import './index.css';
import { useI18n } from '../../../../../i18n';
import { AGENT_REGISTRY } from '../../../../../config/agentRegistry';
import type { CanvasNode } from '../../../../../types';
import { useTextareaMention } from '../../../../node-mentions';
import { isImeComposing } from '../../../../../utils/ime';
import { NodeMentionPicker } from '../../../../node-mentions';
import { truncatePath } from '../utils/terminal';

interface Props {
  selectedAgent: string;
  cwdInput: string;
  promptInput: string;
  dangerousMode: boolean;
  rootFolder?: string;
  recentCwds: string[];
  variant?: 'default' | 'team-lead';
  availabilitySlot?: ReactNode;
  teamLeadBriefSlot?: ReactNode;
  mentionNodes?: CanvasNode[];
  onCwdChange: (value: string) => void;
  onPromptChange: (value: string) => void;
  onDangerousModeChange: (value: boolean) => void;
  onPickFolder: () => void;
  onLaunch: () => void;
}

const FolderGlyph = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M2 4.5A1.5 1.5 0 013.5 3H6l1.5 1.5h5A1.5 1.5 0 0114 6v5.5a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 11.5v-7z" stroke="currentColor" strokeWidth="1.25" />
  </svg>
);

const ChatGlyph = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M2.5 4.5A1.5 1.5 0 014 3h8a1.5 1.5 0 011.5 1.5v5A1.5 1.5 0 0112 11H6.5L4 13.2V11A1.5 1.5 0 012.5 9.5v-5z" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
  </svg>
);

const PlayGlyph = () => (
  <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M4 3l9 5-9 5V3z" fill="currentColor" />
  </svg>
);

const dangerousFlagForAgent = (agentType: string): string =>
  agentType === 'claude-code'
    ? '--dangerously-skip-permissions'
    : agentType === 'codex'
      ? '--dangerously-bypass-approvals-and-sandbox'
      : '';

export const AgentLaunchForm = ({
  selectedAgent,
  cwdInput,
  promptInput,
  dangerousMode,
  rootFolder,
  recentCwds,
  variant = 'default',
  availabilitySlot,
  teamLeadBriefSlot,
  mentionNodes,
  onCwdChange,
  onPromptChange,
  onDangerousModeChange,
  onPickFolder,
  onLaunch,
}: Props) => {
  const { t } = useI18n();
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const promptMention = useTextareaMention({ textareaRef: promptRef, value: promptInput, onChange: onPromptChange });
  const effectiveCwd = cwdInput || rootFolder || '';
  const visibleRecents = recentCwds.filter((path) => path !== cwdInput).slice(0, 3);
  const teamLead = variant === 'team-lead';
  const dangerousFlag = dangerousFlagForAgent(selectedAgent);
  const agent = AGENT_REGISTRY.find((item) => item.id === selectedAgent);
  const startTitle = `Start ${agent?.label ?? 'agent'}  —  ${agent?.command ?? 'agent'}${(teamLead || dangerousMode) && dangerousFlag ? ` ${dangerousFlag}` : ''}${effectiveCwd ? ` in ${effectiveCwd}` : ''}`;

  return (
    <>
      {!teamLead && promptMention.pickerOpen && (
        <NodeMentionPicker nodes={mentionNodes ?? []} onSelect={promptMention.handleSelect} onClose={promptMention.handleClose} />
      )}
      <div className="agent-card-body">
      {availabilitySlot}
      {teamLead ? (
        <>
          <div className="agent-team-lead-setup-summary">
            <div><span>Workspace</span><strong title={effectiveCwd || '~'}>{effectiveCwd ? truncatePath(effectiveCwd, 46) : '~'}</strong></div>
            <div><span>Approvals</span><strong>Bypassed</strong></div>
            <div><span>Prompt</span><strong>Brief Team Lead</strong></div>
          </div>
          {teamLeadBriefSlot}
        </>
      ) : (
        <>
          <div className="agent-field">
            <div className="agent-field-label"><FolderGlyph /><span>Working Directory</span></div>
            <div className="agent-dir-field">
              <input
                type="text"
                className="agent-dir-input"
                value={cwdInput}
                onChange={(event) => onCwdChange(event.target.value)}
                placeholder={rootFolder ? truncatePath(rootFolder, 36) : '~'}
                title={rootFolder ? `Defaults to workspace root: ${rootFolder}` : 'Defaults to your home directory'}
                spellCheck={false}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !isImeComposing(event)) {
                    event.preventDefault();
                    onLaunch();
                  }
                }}
              />
              <button type="button" className="agent-dir-icon" onClick={onPickFolder} title="Browse…" aria-label="Browse for folder"><FolderGlyph /></button>
            </div>
            {visibleRecents.length > 0 && (
              <div className="agent-recent">
                <span className="agent-recent-label">Recent</span>
                {visibleRecents.map((path) => (
                  <button key={path} type="button" className="agent-recent-chip" onClick={() => onCwdChange(path)} title={path}>{truncatePath(path, 22)}</button>
                ))}
              </div>
            )}
          </div>

          <div className="agent-field">
            <div className="agent-field-label"><ChatGlyph /><span>Initial Prompt</span></div>
            <textarea
              ref={promptRef}
              className="agent-prompt-input"
              value={promptInput}
              onChange={(event) => onPromptChange(event.target.value)}
              onKeyDown={(event) => {
                if (promptMention.handleKeyDown(event)) return;
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  onLaunch();
                }
              }}
              placeholder={t('agent.promptPlaceholder')}
              spellCheck={false}
              rows={3}
            />
          </div>

          {dangerousFlag && (
            <div className="agent-field">
              <label className="agent-dangerous-toggle" title={`Adds \`${dangerousFlag}\` to the launch command`}>
                <input type="checkbox" checked={dangerousMode} onChange={(event) => onDangerousModeChange(event.target.checked)} />
                <span className="agent-dangerous-toggle-text">{t('agent.skipPermissions')} <code>{dangerousFlag}</code></span>
              </label>
            </div>
          )}
        </>
      )}
      </div>

      {(!teamLead || !teamLeadBriefSlot) && (
        <div className="agent-card-footer" style={{ border: 'none' }}>
          <button type="button" className="agent-primary-btn" style={{ opacity: 0.8 }} onClick={onLaunch} title={startTitle}>
            <PlayGlyph />{teamLead ? 'Start lead' : t('agent.initialize')}
          </button>
        </div>
      )}
    </>
  );
};
