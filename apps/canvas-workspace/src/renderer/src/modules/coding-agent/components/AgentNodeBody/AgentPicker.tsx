import type { ReactNode } from 'react';
import type { CanvasNode } from '../../../../types';
import { useI18n } from '../../../../i18n';
import { AgentAvailability } from './AgentAvailability';
import { AgentLaunchForm } from './AgentLaunchForm';

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
  mentionNodes?: CanvasNode[];
  onBack?: () => void;
  onAgentChange: (id: string) => void;
  onCwdChange: (value: string) => void;
  onPromptChange: (value: string) => void;
  onDangerousModeChange: (value: boolean) => void;
  onPickFolder: () => void;
  onLaunch: (options?: { skipPreflight?: boolean }) => void;
}

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
  mentionNodes,
  onBack,
  onAgentChange,
  onCwdChange,
  onPromptChange,
  onDangerousModeChange,
  onPickFolder,
  onLaunch,
}: AgentPickerProps) => {
  const { t } = useI18n();
  return (
    <div className="agent-body-wrap agent-body-wrap--setup">
      <div className="agent-card">
        {onBack && (
          <div className="agent-card-back">
            <button type="button" className="agent-text-link" onClick={onBack} title="Back to saved configuration">
              ← {t('agent.back')}
            </button>
          </div>
        )}
        <AgentLaunchForm
          selectedAgent={selectedAgent}
          cwdInput={cwdInput}
          promptInput={promptInput}
          dangerousMode={dangerousMode}
          rootFolder={rootFolder}
          recentCwds={recentCwds}
          variant={variant}
          teamLeadBriefSlot={teamLeadBriefSlot}
          mentionNodes={mentionNodes}
          onCwdChange={onCwdChange}
          onPromptChange={onPromptChange}
          onDangerousModeChange={onDangerousModeChange}
          onPickFolder={onPickFolder}
          onLaunch={() => onLaunch()}
          availabilitySlot={(
            <AgentAvailability
              selectedAgent={selectedAgent}
              launchErrorCommand={launchErrorCommand}
              onAgentChange={onAgentChange}
              onStartAnyway={() => onLaunch({ skipPreflight: true })}
            />
          )}
        />
      </div>
    </div>
  );
};
