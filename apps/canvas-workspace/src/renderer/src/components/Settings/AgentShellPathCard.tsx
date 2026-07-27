import { useState } from 'react';
import type { ShellPathResult } from '../../types';
import { useAppShell } from '../AppShellProvider';
import { useI18n } from '../../i18n';
import { Button } from '../ui';

interface Props {
  shellPath: ShellPathResult;
  onConfigured: () => Promise<void>;
}

export const AgentShellPathCard = ({ shellPath, onConfigured }: Props) => {
  const { notify } = useAppShell();
  const { t } = useI18n();
  const [configuring, setConfiguring] = useState(false);

  const configure = async () => {
    setConfiguring(true);
    try {
      const result = await window.canvasWorkspace.skills.configurePath();
      if (!result.ok) throw new Error(result.error ?? t('agent.installFailed'));
      await onConfigured();
      notify({
        tone: 'success',
        title: t('agent.shellPathTitle'),
        description: t('agent.shellPathReady', { profile: result.profilePath ?? '' }),
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
      <div className="agent-section-cli-title">{t('agent.shellPathTitle')}</div>
      <div className="agent-section-cli-desc">
        {shellPath.configured
          ? t('agent.shellPathReady', { profile: shellPath.profilePath ?? '' })
          : shellPath.supported
            ? t('agent.shellPathSetup', { profile: shellPath.profilePath ?? '' })
            : t('agent.shellPathUnsupported')}
      </div>
      <div className="agent-section-cli-cmd-row">
        <code className="agent-section-cli-cmd">
          {shellPath.configured ? 'pulse-canvas --help' : shellPath.command}
        </code>
        {shellPath.supported && !shellPath.configured && (
          <Button variant="secondary" size="sm" onClick={() => void configure()} disabled={configuring}>
            {t('agent.shellPathConfigure')}{configuring ? '…' : ''}
          </Button>
        )}
      </div>
    </div>
  );
};
