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
  const copy = {
    title: t('settings.shellPath.title'),
    ready: (profile: string) => t('settings.shellPath.ready', { profile }),
    setup: (profile: string) => t('settings.shellPath.setup', { profile }),
    configure: t('settings.shellPath.configure'),
    unsupported: t('settings.shellPath.unsupported'),
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
