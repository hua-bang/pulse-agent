import { useState } from 'react';
import type { ShellPathResult } from '../../types';
import { useAppShell } from '../AppShellProvider';
import { useI18n } from '../../i18n';
import { Button } from '../ui';

interface AgentShellPathCardProps {
  shellPath: ShellPathResult;
  onConfigured: () => Promise<void>;
}

const AgentShellPathCard = ({ shellPath, onConfigured }: AgentShellPathCardProps) => {
  const { notify } = useAppShell();
  const { language, t } = useI18n();
  const [configuring, setConfiguring] = useState(false);
  const copy = language === 'zh'
    ? {
        title: '终端命令',
        ready: (profile: string) => `已在 ${profile} 中配置 pulse-canvas。打开新终端后即可使用。`,
        setup: (profile: string) => `将托管 CLI 目录加入 ${profile}，之后可在新终端中直接运行 pulse-canvas。`,
        configure: '配置 PATH',
        unsupported: '自动配置仅支持 zsh、bash 和 fish。请手动执行下面的命令。',
      }
    : {
        title: 'Terminal command',
        ready: (profile: string) => `pulse-canvas is configured in ${profile}. Open a new terminal to use it.`,
        setup: (profile: string) => `Add the managed CLI directory to ${profile} so new terminals can run pulse-canvas directly.`,
        configure: 'Configure PATH',
        unsupported: 'Automatic setup supports zsh, bash, and fish. Run the command below manually.',
      };

  const configure = async () => {
    setConfiguring(true);
    try {
      const result = await window.canvasWorkspace.skills.configurePath();
      if (!result.ok) throw new Error(result.error ?? t('agent.installFailed'));
      await onConfigured();
      notify({
        tone: 'success',
        title: copy.title,
        description: copy.ready(result.profilePath ?? ''),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      notify({ tone: 'error', title: t('agent.installFailed'), description: message });
    } finally {
      setConfiguring(false);
    }
  };

  return (
    <div className="agent-section-cli">
      <div className="agent-section-cli-title">{copy.title}</div>
      <div className="agent-section-cli-desc">
        {shellPath.configured
          ? copy.ready(shellPath.profilePath ?? '')
          : shellPath.supported
            ? copy.setup(shellPath.profilePath ?? '')
            : copy.unsupported}
      </div>
      <div className="agent-section-cli-cmd-row">
        <code className="agent-section-cli-cmd">
          {shellPath.configured ? 'pulse-canvas --help' : shellPath.command}
        </code>
        {shellPath.supported && !shellPath.configured && (
          <Button variant="secondary" size="sm" onClick={() => void configure()} disabled={configuring}>
            {copy.configure}{configuring ? '…' : ''}
          </Button>
        )}
      </div>
    </div>
  );
};

export default AgentShellPathCard;
