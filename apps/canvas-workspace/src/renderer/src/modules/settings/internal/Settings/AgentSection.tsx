import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import type {
  AgentToolingUpdatePolicy,
  SkillsInstallResult,
  SkillsStatusResult,
  SkillTargetResult,
} from '../../../../types';
import { useAppShell } from '../../../../shared/appShell';
import { useI18n } from '../../../../i18n';
import { Button, FieldRow, Select } from '../../../../components/ui';
import './AgentSection.css';

const AgentShellPathCard = lazy(() =>
  import('./AgentShellPathCard').then((module) => ({ default: module.AgentShellPathCard })),
);

interface AgentSectionProps {
  onClose: () => void;
}

export const AgentSection = ({ onClose }: AgentSectionProps) => {
  const { notify } = useAppShell();
  const { t } = useI18n();
  const [status, setStatus] = useState<SkillsStatusResult | null>(null);
  const [lastResults, setLastResults] = useState<SkillTargetResult[] | null>(null);
  const [checking, setChecking] = useState(true);
  const [installing, setInstalling] = useState(false);
  const [cleaningLegacy, setCleaningLegacy] = useState(false);
  const [changingPolicy, setChangingPolicy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    setChecking(true);
    try {
      const s = await window.canvasWorkspace.skills.status();
      setStatus(s);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const install = useCallback(async (action: 'repair' | 'update' = 'repair') => {
    setInstalling(true);
    setError(null);
    try {
      const result: SkillsInstallResult = action === 'update'
        ? await window.canvasWorkspace.skills.update()
        : await window.canvasWorkspace.skills.install();
      setLastResults(result.results);
      await loadStatus();
      const failed = result.results.filter((r) => !r.ok);
      if (result.ok) {
        notify({
          tone: 'success',
          title: t('agent.skillInstalled'),
          description: t('agent.wroteTargets', {
            count: result.results.length,
            plural: result.results.length === 1 ? '' : 's',
          }),
        });
      } else {
        if (result.cliError) setError(result.cliError);
        notify({
          tone: 'error',
          title: t('agent.someTargetsFailed'),
          description: result.cliError ?? t('agent.someTargetsFailedDescription', {
              failed: failed.length,
              total: result.results.length,
              plural: result.results.length === 1 ? '' : 's',
            }),
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      notify({ tone: 'error', title: t('agent.installFailed'), description: msg });
    } finally {
      setInstalling(false);
    }
  }, [loadStatus, notify, t]);

  const cleanupLegacy = useCallback(async () => {
    setCleaningLegacy(true);
    try {
      const result = await window.canvasWorkspace.skills.cleanupLegacy();
      await loadStatus();
      const failed = result.results.filter((r) => !r.ok);
      if (failed.length === 0) {
        notify({
          tone: 'success',
          title: t('agent.legacyRemoved'),
          description: t('agent.cleanedDirs', {
            count: result.results.length,
            suffix: result.results.length === 1 ? 'y' : 'ies',
          }),
        });
      } else {
        notify({
          tone: 'error',
          title: t('agent.cleanupPartiallyFailed'),
          description: t('agent.cleanupPartiallyFailedDescription', {
            failed: failed.length,
            total: result.results.length,
          }),
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      notify({ tone: 'error', title: t('agent.cleanupFailed'), description: msg });
    } finally {
      setCleaningLegacy(false);
    }
  }, [loadStatus, notify, t]);

  const changePolicy = useCallback(async (value: string) => {
    if (value !== 'follow-app' && value !== 'ask' && value !== 'pinned') return;
    setChangingPolicy(true);
    setError(null);
    try {
      const next = await window.canvasWorkspace.skills.setUpdatePolicy(
        value as AgentToolingUpdatePolicy,
      );
      setStatus((current) => current ? { ...current, ...next } : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setChangingPolicy(false);
    }
  }, []);

  const allInstalled = status?.installed ?? false;
  const legacyDirs = status?.legacyDirs ?? [];
  const buttonLabel = !status ? t('chat.retry') : installing
    ? t('agent.installing')
    : status?.version
      ? t('agent.reinstallSkill')
      : t('agent.installSkill');
  const policyOptions = [
    {
      value: 'follow-app',
      label: t('agent.policyFollow'),
      description: t('agent.policyFollowDescription'),
    },
    {
      value: 'ask',
      label: t('agent.policyAsk'),
      description: t('agent.policyAskDescription'),
    },
    {
      value: 'pinned',
      label: t('agent.policyPinned'),
      description: t('agent.policyPinnedDescription'),
    },
  ];

  return (
    <div className="agent-section">
      <div className="agent-section-body">
        <div className="agent-section-card">
          <div className="agent-section-card-header">
            <div>
              <div className="agent-section-card-title">{t('agent.title')}</div>
              <div className="agent-section-card-desc">
                {t('agent.description')}
              </div>
            </div>
            {!allInstalled && <Button variant="primary" size="sm" onClick={() => void (status ? install() : loadStatus())} disabled={installing || checking}>
              {buttonLabel}
            </Button>}
          </div>

          <p className="agent-section-connection-status" data-state={checking ? 'checking' : allInstalled ? 'ready' : status?.version ? 'repair' : 'inactive'} role="status">{checking ? t('agent.checking') : !status ? t('agent.checkFailed') : allInstalled
            ? t('agent.ready') : status.version ? t('agent.needsRepair') : t('agent.notInstalled')}</p>
          {!checking && (error || (status?.version && !allInstalled)) && (
            <div className="agent-section-error">
              {error ? t('agent.repairFailedHint') : !status?.cliInstalled ? t('agent.launcherRepairHint') : t('agent.skillsRepairHint')}
            </div>
          )}

          {!checking && (error || (status?.version && !allInstalled)) && (
            <Button variant="secondary" size="sm" onClick={async () => {
              try {
                await navigator.clipboard.writeText(JSON.stringify({ status, error, lastResults }, null, 2));
                notify({ tone: 'success', title: t('chat.copied') });
              } catch (err) {
                notify({ tone: 'error', title: t('sidebar.copyFailed'), description: String(err) });
              }
            }}>{t('agent.copyDiagnostics')}</Button>
          )}
          {status && <details className="agent-section-details">
            <summary>{t('agent.advanced')}</summary>
            <div className="agent-section-details-content">
          {status && (
            <div className="agent-section-tooling-status">
              <FieldRow
                className="agent-section-policy-row"
                label={t('agent.updatePolicy')}
                hint={t('agent.updatePolicyDescription')}
              >
                <Select
                  value={status.updatePolicy}
                  options={policyOptions}
                  onChange={(value) => void changePolicy(value)}
                  ariaLabel={t('agent.updatePolicy')}
                  disabled={changingPolicy || installing}
                  className="agent-section-policy-select"
                />
              </FieldRow>
            </div>
          )}

          {status?.updateAvailable && (
            <div className="agent-section-update">
              <div>
                <div className="agent-section-update-title">{t('agent.updateAvailable')}</div>
                <div className="agent-section-update-desc">
                  {t('agent.updateHint')}
                </div>
              </div>
              <Button variant="primary" size="sm" onClick={() => void install('update')} disabled={installing}>
                {t('agent.updateNow')}
              </Button>
            </div>
          )}

          {status?.cliInstalled && (
            <Suspense fallback={null}>
              <AgentShellPathCard shellPath={status.shellPath} onConfigured={loadStatus} />
            </Suspense>
          )}

          {legacyDirs.length > 0 && (
            <div className="agent-section-warning">
              <div className="agent-section-warning-header">
                <div>
                  <div className="agent-section-warning-title">
                    {t('agent.legacyDetected')}
                  </div>
                  <div className="agent-section-warning-desc">
                    {t('agent.legacyDescription')}
                  </div>
                </div>
                <Button variant="secondary" size="sm" onClick={() => void cleanupLegacy()} disabled={cleaningLegacy}>
                  {cleaningLegacy ? t('agent.removing') : t('agent.removeLegacyDirs')}
                </Button>
              </div>
            </div>
          )}

            </div>
          </details>}
        </div>
      </div>

      <div className="agent-section-footer">
        <Button variant="secondary" size="sm" onClick={onClose}>
          {t('agent.close')}
        </Button>
      </div>
    </div>
  );
};
