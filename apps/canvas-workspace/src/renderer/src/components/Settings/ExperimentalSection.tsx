import { useCallback, useEffect, useState } from 'react';
import type { ExperimentalFeatureDef } from '../../types';
import { useAppShell } from '../AppShellProvider';
import './ExperimentalSection.css';

interface ExperimentalSectionProps {
  onClose: () => void;
}

export const ExperimentalSection = ({ onClose }: ExperimentalSectionProps) => {
  const { notify } = useAppShell();
  const [features, setFeatures] = useState<ExperimentalFeatureDef[]>([]);
  const [values, setValues] = useState<Record<string, boolean>>({});
  const [path, setPath] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [needsReload, setNeedsReload] = useState(false);
  const [reloading, setReloading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await window.canvasWorkspace.experimental.list();
      if (res.ok) {
        setFeatures(res.features ?? []);
        setValues(res.values ?? {});
        setPath(res.path ?? '');
        setError(null);
      } else {
        setError(res.error ?? 'Failed to load experimental features');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = useCallback(
    async (id: string, enabled: boolean) => {
      setPending((p) => ({ ...p, [id]: true }));
      const previous = values[id];
      setValues((v) => ({ ...v, [id]: enabled }));
      try {
        const res = await window.canvasWorkspace.experimental.set(id, enabled);
        if (!res.ok) {
          setValues((v) => ({ ...v, [id]: previous ?? false }));
          notify({
            tone: 'error',
            title: 'Could not update flag',
            description: res.error ?? 'Unknown error',
          });
          return;
        }
        if (res.values) setValues(res.values);
        setNeedsReload(true);
      } catch (err) {
        setValues((v) => ({ ...v, [id]: previous ?? false }));
        notify({
          tone: 'error',
          title: 'Could not update flag',
          description: err instanceof Error ? err.message : String(err),
        });
      } finally {
        setPending((p) => {
          const next = { ...p };
          delete next[id];
          return next;
        });
      }
    },
    [values, notify],
  );

  const resetAll = useCallback(async () => {
    const res = await window.canvasWorkspace.experimental.reset();
    if (res.ok) {
      if (res.values) setValues(res.values);
      setNeedsReload(true);
      notify({
        tone: 'success',
        title: 'Experimental flags reset',
        description: 'All flags restored to their defaults.',
      });
    } else {
      notify({
        tone: 'error',
        title: 'Reset failed',
        description: res.error ?? 'Unknown error',
      });
    }
  }, [notify]);

  const reload = useCallback(async () => {
    setReloading(true);
    try {
      await window.canvasWorkspace.experimental.reloadWindow();
    } catch (err) {
      setReloading(false);
      notify({
        tone: 'error',
        title: 'Reload failed',
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }, [notify]);

  return (
    <div className="experimental-section">
      <div className="experimental-section-body">
        <div className="experimental-section-intro">
          <div className="experimental-section-intro-title">Experimental features</div>
          <div className="experimental-section-intro-desc">
            Opt in to unfinished or unstable features. They may change behaviour, move,
            or disappear without notice. Toggling a flag requires a window reload to
            take effect.
          </div>
          {path && (
            <div className="experimental-section-path">
              Stored at <code>{path}</code>
            </div>
          )}
        </div>

        {needsReload && (
          <div className="experimental-section-reload-banner">
            <div className="experimental-section-reload-text">
              Reload the window to apply your changes.
            </div>
            <button
              type="button"
              className="experimental-section-primary-btn"
              onClick={() => void reload()}
              disabled={reloading}
            >
              {reloading ? 'Reloading…' : 'Reload window'}
            </button>
          </div>
        )}

        {error && <div className="experimental-section-error">{error}</div>}

        {loading ? (
          <div className="experimental-section-empty">Loading…</div>
        ) : features.length === 0 ? (
          <div className="experimental-section-empty">
            No experimental features registered yet. Add entries to{' '}
            <code>src/shared/experimental-features.ts</code> to surface a toggle here.
          </div>
        ) : (
          <ul className="experimental-section-list" aria-label="Experimental features">
            {features.map((feature) => {
              const enabled = !!values[feature.id];
              const busy = !!pending[feature.id];
              return (
                <li key={feature.id} className="experimental-section-item">
                  <div className="experimental-section-item-body">
                    <div className="experimental-section-item-label">{feature.label}</div>
                    <div className="experimental-section-item-desc">{feature.description}</div>
                    <div className="experimental-section-item-meta">
                      <code>{feature.id}</code>
                      <span>· default: {feature.defaultEnabled ? 'on' : 'off'}</span>
                    </div>
                  </div>
                  <label
                    className={`experimental-section-switch${enabled ? ' experimental-section-switch--on' : ''}${busy ? ' experimental-section-switch--busy' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={enabled}
                      disabled={busy}
                      onChange={(e) => void toggle(feature.id, e.target.checked)}
                      aria-label={`Toggle ${feature.label}`}
                    />
                    <span className="experimental-section-switch-track" aria-hidden>
                      <span className="experimental-section-switch-thumb" />
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="experimental-section-footer">
        <button
          type="button"
          className="experimental-section-secondary-btn"
          onClick={() => void resetAll()}
        >
          Reset all to defaults
        </button>
        <button
          type="button"
          className="experimental-section-secondary-btn"
          onClick={onClose}
        >
          Close
        </button>
      </div>
    </div>
  );
};
