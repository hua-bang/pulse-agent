import { useCallback, useEffect, useState } from 'react';
import type { CodexPluginStatus } from '../../../../types';
import { useAppShell } from '../../../../shared/appShell';
import { useI18n } from '../../../../i18n';
import { Button } from '../../../../components/ui';

/**
 * Settings → Agent: install the bundled `pulse-canvas` agent plugin into the
 * user's Codex CLI. Nothing touches Codex until the user presses Connect.
 */
const AgentCodexCard = () => {
  const { notify } = useAppShell();
  const { t } = useI18n();
  const [status, setStatus] = useState<CodexPluginStatus | null>(null);
  const [checking, setChecking] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [connectFailed, setConnectFailed] = useState(false);

  const refresh = useCallback(async () => {
    setChecking(true);
    try {
      setStatus(await window.canvasWorkspace.skills.codexStatus());
    } catch (error) {
      setStatus({
        state: 'error',
        codexVersion: null,
        minCodexVersion: '',
        manualCommands: [],
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const connect = async () => {
    setConnecting(true);
    try {
      const result = await window.canvasWorkspace.skills.connectCodex();
      setStatus(result);
      setConnectFailed(!result.ok);
      if (result.ok) {
        notify({ tone: 'success', title: t('agent.codexConnected'), description: t('agent.codexConnectedHint') });
      } else {
        notify({ tone: 'error', title: t('agent.codexConnectFailed'), description: result.error });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setConnectFailed(true);
      notify({ tone: 'error', title: t('agent.codexConnectFailed'), description: message });
    } finally {
      setConnecting(false);
    }
  };

  const state = status?.state;
  const canConnect = state === 'connected' || state === 'disconnected' || state === 'plugin-missing';
  const failedMessage = connectFailed && state !== 'connected' && status?.error
    ? t('agent.codexStateFailed', { error: status.error })
    : null;
  const message = checking
    ? t('agent.checking')
    : failedMessage
      ? failedMessage
      : state === 'connected'
      ? t('agent.codexStateConnected')
      : state === 'disconnected'
        ? t('agent.codexStateDisconnected')
        : state === 'codex-missing'
          ? t('agent.codexStateMissing')
          : state === 'codex-outdated'
            ? t('agent.codexStateOutdated', { version: status?.codexVersion ?? '', min: status?.minCodexVersion ?? '' })
            : state === 'unsupported-platform'
              ? t('agent.codexStateUnsupported')
              : t('agent.codexStateError', { error: status?.error ?? '' });
  // The button already runs these; show them only when the automatic path failed.
  const showManual = !checking && status && state !== 'connected' && status.manualCommands.length > 0
    && (connectFailed || state === 'error' || state === 'plugin-missing');

  return (
    <div className="agent-section-card">
      <div className="agent-section-card-header">
        <div>
          <div className="agent-section-card-title">{t('agent.codexTitle')}</div>
          <div className="agent-section-card-desc">{t('agent.codexDescription')}</div>
        </div>
        {canConnect && (
          <Button
            variant={state === 'connected' ? 'secondary' : 'primary'}
            size="sm"
            onClick={() => void connect()}
            disabled={connecting || checking}
          >
            {connecting
              ? t('agent.codexConnecting')
              : state === 'connected' ? t('agent.codexReconnect') : t('agent.codexConnect')}
          </Button>
        )}
      </div>
      <p
        className="agent-section-connection-status"
        data-state={checking ? 'checking' : state === 'connected' ? 'ready' : canConnect && !failedMessage ? 'inactive' : 'repair'}
        role="status"
      >
        {message}
      </p>
      {showManual && (
        <div className="agent-section-cli">
          <div className="agent-section-cli-desc">{t('agent.codexManual')}</div>
          {status.manualCommands.map(command => (
            <div className="agent-section-cli-cmd-row" key={command}>
              <code className="agent-section-cli-cmd">{command}</code>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default AgentCodexCard;
