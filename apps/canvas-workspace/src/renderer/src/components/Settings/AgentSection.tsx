import { useCallback, useEffect, useState } from 'react';
import type { SkillsInstallResult, SkillsStatusResult, SkillTargetResult } from '../../types';
import { useAppShell } from '../AppShellProvider';
import { useI18n } from '../../i18n';
import './AgentSection.css';

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
  const [error, setError] = useState<string | null>(null);
  const [manualCommand, setManualCommand] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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

  const install = useCallback(async () => {
    setInstalling(true);
    setError(null);
    try {
      const result: SkillsInstallResult = await window.canvasWorkspace.skills.install();
      setLastResults(result.results);
      setManualCommand(result.manualCommand ?? null);
      await loadStatus();
      const failed = result.results.filter((r) => !r.ok);
      if (failed.length === 0) {
        notify({
          tone: 'success',
          title: t('agent.skillInstalled'),
          description: t('agent.wroteTargets', {
            count: result.results.length,
            plural: result.results.length === 1 ? '' : 's',
          }),
        });
      } else {
        notify({
          tone: 'error',
          title: t('agent.someTargetsFailed'),
          description: t('agent.someTargetsFailedDescription', {
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

  const displayResults = lastResults ?? status?.results ?? [];
  const allInstalled = status?.installed ?? false;
  const legacyDirs = status?.legacyDirs ?? [];
  const buttonLabel = installing
    ? t('agent.installing')
    : allInstalled
      ? t('agent.reinstallSkill')
      : t('agent.installSkill');

  const copyManualCommand = useCallback(async () => {
    if (!manualCommand) return;
    try {
      await navigator.clipboard.writeText(manualCommand);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      notify({
        tone: 'error',
        title: t('agent.copyFailed'),
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }, [manualCommand, notify, t]);

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
            <button
              type="button"
              className="agent-section-primary-btn"
              onClick={() => void install()}
              disabled={installing}
            >
              {buttonLabel}
            </button>
          </div>

          {error && <div className="agent-section-error">{error}</div>}

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
                <button
                  type="button"
                  className="agent-section-secondary-btn"
                  onClick={() => void cleanupLegacy()}
                  disabled={cleaningLegacy}
                >
                  {cleaningLegacy ? t('agent.removing') : t('agent.removeLegacyDirs')}
                </button>
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

          {manualCommand && (
            <div className="agent-section-cli">
              <div className="agent-section-cli-title">
                {t('agent.nextStepTitle')}
              </div>
              <div className="agent-section-cli-desc">
                {t('agent.nextStepDescription')}
              </div>
              <div className="agent-section-cli-cmd-row">
                <code className="agent-section-cli-cmd">{manualCommand}</code>
                <button
                  type="button"
                  className="agent-section-secondary-btn"
                  onClick={() => void copyManualCommand()}
                >
                  {copied ? t('agent.copied') : t('agent.copy')}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="agent-section-footer">
        <button type="button" className="agent-section-secondary-btn" onClick={onClose}>
          {t('agent.close')}
        </button>
      </div>
    </div>
  );
};
