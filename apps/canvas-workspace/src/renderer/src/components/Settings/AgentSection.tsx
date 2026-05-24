import { useCallback, useEffect, useState } from 'react';
import type { SkillsInstallResult, SkillsStatusResult, SkillTargetResult } from '../../types';
import { useAppShell } from '../AppShellProvider';
import './AgentSection.css';

interface AgentSectionProps {
  onClose: () => void;
}

export const AgentSection = ({ onClose }: AgentSectionProps) => {
  const { notify } = useAppShell();
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
          title: 'Pulse Canvas skill installed',
          description: `Wrote ${result.results.length} target${result.results.length === 1 ? '' : 's'}`,
        });
      } else {
        notify({
          tone: 'error',
          title: 'Some targets failed',
          description: `${failed.length} of ${result.results.length} target${result.results.length === 1 ? '' : 's'} failed — see details below`,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      notify({ tone: 'error', title: 'Install failed', description: msg });
    } finally {
      setInstalling(false);
    }
  }, [loadStatus, notify]);

  const cleanupLegacy = useCallback(async () => {
    setCleaningLegacy(true);
    try {
      const result = await window.canvasWorkspace.skills.cleanupLegacy();
      await loadStatus();
      const failed = result.results.filter((r) => !r.ok);
      if (failed.length === 0) {
        notify({
          tone: 'success',
          title: 'Legacy skill dirs removed',
          description: `Cleaned ${result.results.length} director${result.results.length === 1 ? 'y' : 'ies'}`,
        });
      } else {
        notify({
          tone: 'error',
          title: 'Cleanup partially failed',
          description: `${failed.length} of ${result.results.length} could not be removed`,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      notify({ tone: 'error', title: 'Cleanup failed', description: msg });
    } finally {
      setCleaningLegacy(false);
    }
  }, [loadStatus, notify]);

  const displayResults = lastResults ?? status?.results ?? [];
  const allInstalled = status?.installed ?? false;
  const legacyDirs = status?.legacyDirs ?? [];
  const buttonLabel = installing
    ? 'Installing…'
    : allInstalled
      ? 'Reinstall Pulse Canvas Skill'
      : 'Install Pulse Canvas Skill';

  const copyManualCommand = useCallback(async () => {
    if (!manualCommand) return;
    try {
      await navigator.clipboard.writeText(manualCommand);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      notify({
        tone: 'error',
        title: 'Copy failed',
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }, [manualCommand, notify]);

  return (
    <div className="agent-section">
      <div className="agent-section-body">
        <div className="agent-section-card">
          <div className="agent-section-card-header">
            <div>
              <div className="agent-section-card-title">Pulse Canvas Skill</div>
              <div className="agent-section-card-desc">
                Install the <code>pulse-canvas</code> skill into Pulse Coder, Claude Code, and Codex
                global skill directories so each agent can read and write this workspace via the{' '}
                <code>pulse-canvas</code> CLI.
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
                    Legacy <code>canvas</code> skill detected
                  </div>
                  <div className="agent-section-warning-desc">
                    The skill was renamed to <code>pulse-canvas</code>. Remove the old directories
                    to avoid agents loading both versions.
                  </div>
                </div>
                <button
                  type="button"
                  className="agent-section-secondary-btn"
                  onClick={() => void cleanupLegacy()}
                  disabled={cleaningLegacy}
                >
                  {cleaningLegacy ? 'Removing…' : 'Remove legacy dirs'}
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
            <ul className="agent-section-results" aria-label="Skill install targets">
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
                Next step: install the <code>pulse-canvas</code> CLI
              </div>
              <div className="agent-section-cli-desc">
                The skill requires the <code>pulse-canvas</code> CLI on your PATH. It is not
                published yet — run this command from the repo root:
              </div>
              <div className="agent-section-cli-cmd-row">
                <code className="agent-section-cli-cmd">{manualCommand}</code>
                <button
                  type="button"
                  className="agent-section-secondary-btn"
                  onClick={() => void copyManualCommand()}
                >
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="agent-section-footer">
        <button type="button" className="agent-section-secondary-btn" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
};
