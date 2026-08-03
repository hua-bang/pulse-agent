import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import type {
  AgentToolingUpdatePolicy,
  SkillsInstallResult,
  SkillsStatusResult,
  SkillTargetResult,
} from '../../types';
import { useAppShell } from '../AppShellProvider';
import { useI18n } from '../../i18n';
import { Button, FieldRow, Select } from '../ui';
import './AgentSection.css';

const AgentShellPathCard = lazy(() =>
  import('./AgentShellPathCard').then((m) => ({ default: m.AgentShellPathCard })),
);

interface AgentSectionProps {
  onClose: () => void;
}

export const AgentSection = ({ onClose }: AgentSectionProps) => {
  const { notify } = useAppShell();
  const { t } = useI18n();
  const [status, setStatus] = useState<SkillsStatusResult | null>(null);
  const [lastResults, setLastResults] = useState<SkillTargetResult[] | null>(null);
  const [installing, setInstalling] = useState(false);
  const [cleaningLegacy, setCleaningLegacy] = useState(false);
  const [changingPolicy, setChangingPolicy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const s = await window.canvasWorkspace.skills.status();
      setStatus(s);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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

  const displayResults = [
    ...(status ? [{ path: status.cliPath, ok: status.cliInstalled }] : []),
    ...(lastResults ?? status?.results ?? []),
  ];
  const allInstalled = status?.installed ?? false;
  const legacyDirs = status?.legacyDirs ?? [];
  const buttonLabel = installing
    ? t('agent.installing')
    : allInstalled
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
            <Button variant="primary" size="sm" onClick={() => void install()} disabled={installing}>
              {buttonLabel}
            </Button>
          </div>

          {error && <div className="agent-section-error">{error}</div>}

          {status && (
            <div className="agent-section-tooling-status">
              <div className="agent-section-version-row">
                <div>
                  <div className="agent-section-version-label">{t('agent.installedVersion')}</div>
                  <code>{status.version ?? t('agent.notInstalled')}</code>
                </div>
                <div>
                  <div className="agent-section-version-label">{t('agent.bundledVersion')}</div>
                  <code>{status.bundledVersion ?? t('agent.unavailable')}</code>
                </div>
              </div>
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
                  {t('agent.updateAvailableDescription', {
                    installed: status.version ?? t('agent.notInstalled'),
                    bundled: status.bundledVersion ?? t('agent.unavailable'),
                  })}
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
              <ul className="agent-section-warning-list">
                {legacyDirs.map((dir) => (
                  <li key={dir}>
                    <code>{dir}</code>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {displayResults.length > 0 && (
            <ul className="agent-section-results" aria-label={t('agent.targetsAria')}>
              {displayResults.map((r) => (
                <li
                  key={r.path}
                  className={`agent-section-result${r.ok ? ' agent-section-result--ok' : ' agent-section-result--fail'}`}
                >
                  <span className="agent-section-result-icon" aria-hidden>
                    {r.ok ? '✓' : '✗'}
                  </span>
                  <div className="agent-section-result-body">
                    <code className="agent-section-result-path">{r.path}</code>
                    {r.error && <div className="agent-section-result-error">{r.error}</div>}
                  </div>
                </li>
              ))}
            </ul>
          )}

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
