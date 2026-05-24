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

  const install = useCallback(async () => {
    setInstalling(true);
    setError(null);
    try {
      const result: SkillsInstallResult = await window.canvasWorkspace.skills.install();
      setLastResults(result.results);
      await loadStatus();
      const failed = result.results.filter((r) => !r.ok);
      if (failed.length === 0) {
        notify({
          tone: 'success',
          title: 'Canvas skill installed',
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

  const displayResults = lastResults ?? status?.results ?? [];
  const allInstalled = status?.installed ?? false;
  const buttonLabel = installing
    ? 'Installing…'
    : allInstalled
      ? 'Reinstall Canvas Skill'
      : 'Install Canvas Skill';

  return (
    <div className="agent-section">
      <div className="agent-section-body">
        <div className="agent-section-card">
          <div className="agent-section-card-header">
            <div>
              <div className="agent-section-card-title">Canvas Skill</div>
              <div className="agent-section-card-desc">
                Install the <code>canvas</code> skill into Pulse Coder, Claude Code, and Codex
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
