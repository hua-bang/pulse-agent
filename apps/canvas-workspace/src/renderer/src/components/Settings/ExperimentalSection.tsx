import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import type { ExperimentalFeatureDef } from '../../types';
import {
  EXPERIMENTAL_FLAG_AGENT_TEAMS,
  EXPERIMENTAL_FLAG_CHANNELS,
  EXPERIMENTAL_FLAG_SCHEDULED_MEMORY_REPORT,
} from '../../../../shared/experimental-features';
import { useAppShell } from '../AppShellProvider';
import { useI18n } from '../../i18n';
import { Button } from '../ui';
import { ChannelConfigPanel } from './ChannelConfigPanel';
import './ExperimentalSection.css';

interface ExperimentalSectionProps {
  onClose: () => void;
}

export const ExperimentalSection = ({ onClose }: ExperimentalSectionProps) => {
  const { notify, updateToast } = useAppShell();
  const { t } = useI18n();
  // Id of the in-progress "installing tooling" toast, so the async
  // tooling-status push from main can update it in place.
  const toolingToastRef = useRef<string | null>(null);
  const [features, setFeatures] = useState<ExperimentalFeatureDef[]>([]);
  const [values, setValues] = useState<Record<string, boolean>>({});
  const [path, setPath] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [needsReload, setNeedsReload] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [reportRunning, setReportRunning] = useState(false);

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
        setError(res.error ?? t('experimental.loadFailed'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  // Subscribe to background tooling-install results pushed from main and
  // resolve the in-progress toast (or surface a standalone toast as fallback).
  useEffect(() => {
    const off = window.canvasWorkspace.experimental.onToolingStatus((status) => {
      if (status.feature !== EXPERIMENTAL_FLAG_AGENT_TEAMS) return;
      const patch = status.ok
        ? {
            tone: 'success' as const,
            title: t('experimental.toolingReady'),
            description: t('experimental.toolingReadyDesc'),
            autoCloseMs: 6000,
          }
        : {
            tone: 'error' as const,
            title: t('experimental.toolingCliFailed'),
            description: t('experimental.toolingCliFailedDesc', {
              error: status.cliError ?? t('experimental.unknownError'),
            }),
            autoCloseMs: 0,
          };
      const id = toolingToastRef.current;
      if (id) {
        updateToast(id, patch);
        toolingToastRef.current = null;
      } else {
        notify(patch);
      }
    });
    return off;
  }, [notify, updateToast, t]);

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
            title: t('experimental.updateFailed'),
            description: res.error ?? t('experimental.unknownError'),
          });
          return;
        }
        if (res.values) setValues(res.values);
        setNeedsReload(true);
        // Turning Agent Teams on kicks off a background skill + CLI install in
        // main. Show a persistent "installing" toast now; the tooling-status
        // subscription updates it with the result when the install settles.
        if (id === EXPERIMENTAL_FLAG_AGENT_TEAMS && enabled && !previous) {
          toolingToastRef.current = notify({
            tone: 'loading',
            title: t('experimental.toolingInstalling'),
            description: t('experimental.toolingInstallingDesc'),
          });
        }
        // The scheduled memory report generates via the configured chat
        // model; without one every weekly run fails silently (log-only).
        // Surface that at enable time instead of a week later.
        if (id === EXPERIMENTAL_FLAG_SCHEDULED_MEMORY_REPORT && enabled && !previous) {
          void window.canvasWorkspace.model
            .status()
            .then((res) => {
              if (res.ok && res.status?.apiKeyPresent) return;
              notify({
                tone: 'info',
                title: t('experimental.memoryReportNoModel'),
                description: t('experimental.memoryReportNoModelDesc'),
                autoCloseMs: 0,
              });
            })
            .catch(() => undefined);
        }
      } catch (err) {
        setValues((v) => ({ ...v, [id]: previous ?? false }));
        notify({
          tone: 'error',
          title: t('experimental.updateFailed'),
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
    [values, notify, t],
  );

  // Try-it button for the scheduled memory report: generate one on demand so
  // the user sees the result immediately (the scheduler itself only runs
  // after a full period). Generation can take a while — keep a loading toast
  // open and resolve it with the outcome.
  const runReportNow = useCallback(async () => {
    setReportRunning(true);
    const toastId = notify({
      tone: 'loading',
      title: t('experimental.memoryReportRunning'),
      description: t('experimental.memoryReportRunningDesc'),
    });
    try {
      const res = await window.canvasWorkspace.memoryReport.runNow();
      updateToast(
        toastId,
        res.ok
          ? {
              tone: 'success',
              title: t('experimental.memoryReportDone'),
              description: t('experimental.memoryReportDoneDesc'),
              autoCloseMs: 6000,
            }
          : {
              tone: 'error',
              title: t('experimental.memoryReportFailed'),
              description: res.error ?? t('experimental.unknownError'),
              autoCloseMs: 0,
            },
      );
    } catch (err) {
      updateToast(toastId, {
        tone: 'error',
        title: t('experimental.memoryReportFailed'),
        description: err instanceof Error ? err.message : String(err),
        autoCloseMs: 0,
      });
    } finally {
      setReportRunning(false);
    }
  }, [notify, updateToast, t]);

  const resetAll = useCallback(async () => {
    const res = await window.canvasWorkspace.experimental.reset();
    if (res.ok) {
      if (res.values) setValues(res.values);
      setNeedsReload(true);
      notify({
        tone: 'success',
        title: t('experimental.resetSuccess'),
        description: t('experimental.resetDescription'),
      });
    } else {
      notify({
        tone: 'error',
        title: t('experimental.resetFailed'),
        description: res.error ?? t('experimental.unknownError'),
      });
    }
  }, [notify, t]);

  const reload = useCallback(async () => {
    setReloading(true);
    try {
      await window.canvasWorkspace.experimental.reloadWindow();
    } catch (err) {
      setReloading(false);
      notify({
        tone: 'error',
        title: t('experimental.reloadFailed'),
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }, [notify, t]);

  return (
    <div className="experimental-section">
      <div className="experimental-section-body">
        <div className="experimental-section-intro">
          <div className="experimental-section-intro-title">{t('experimental.title')}</div>
          <div className="experimental-section-intro-desc">
            {t('experimental.description')}
          </div>
          {path && (
            <div className="experimental-section-path">
              {t('experimental.storedAt')} <code>{path}</code>
            </div>
          )}
        </div>

        {needsReload && (
          <div className="experimental-section-reload-banner">
            <div className="experimental-section-reload-text">
              {t('experimental.reloadPrompt')}
            </div>
            <Button variant="primary" size="sm" onClick={() => void reload()} disabled={reloading}>
              {reloading ? t('experimental.reloading') : t('experimental.reloadWindow')}
            </Button>
          </div>
        )}

        {error && <div className="experimental-section-error">{error}</div>}

        {loading ? (
          <div className="experimental-section-empty">{t('experimental.loading')}</div>
        ) : features.length === 0 ? (
          <div className="experimental-section-empty">
            {t('experimental.empty')}
          </div>
        ) : (
          <ul className="experimental-section-list" aria-label={t('experimental.featuresAria')}>
            {features.map((feature) => {
              const enabled = !!values[feature.id];
              const busy = !!pending[feature.id];
              const showChannelConfig =
                feature.id === EXPERIMENTAL_FLAG_CHANNELS && enabled;
              const showMemoryReportTry =
                feature.id === EXPERIMENTAL_FLAG_SCHEDULED_MEMORY_REPORT && enabled;
              return (
                <Fragment key={feature.id}>
                <li className="experimental-section-item">
                  <div className="experimental-section-item-body">
                    <div className="experimental-section-item-label">{feature.label}</div>
                    <div className="experimental-section-item-desc">{feature.description}</div>
                    <div className="experimental-section-item-meta">
                      <code>{feature.id}</code>
                      <span>· {t('experimental.defaultState', {
                        state: feature.defaultEnabled ? t('experimental.on') : t('experimental.off'),
                      })}</span>
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
                      aria-label={t('experimental.toggleFeature', { label: feature.label })}
                    />
                    <span className="experimental-section-switch-track" aria-hidden>
                      <span className="experimental-section-switch-thumb" />
                    </span>
                  </label>
                </li>
                {showChannelConfig && (
                  <li className="experimental-section-config-row">
                    <ChannelConfigPanel />
                  </li>
                )}
                {showMemoryReportTry && (
                  <li className="experimental-section-config-row">
                    <div className="experimental-section-item-body">
                      <div className="experimental-section-item-desc">
                        {t('experimental.memoryReportTryDesc')}
                      </div>
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={reportRunning}
                      onClick={() => void runReportNow()}
                    >
                      {reportRunning
                        ? t('experimental.memoryReportRunning')
                        : t('experimental.memoryReportTryBtn')}
                    </Button>
                  </li>
                )}
                </Fragment>
              );
            })}
          </ul>
        )}
      </div>

      <div className="experimental-section-footer">
        <Button variant="secondary" size="sm" onClick={() => void resetAll()}>
          {t('experimental.resetAll')}
        </Button>
        <Button variant="secondary" size="sm" onClick={onClose}>
          {t('experimental.close')}
        </Button>
      </div>
    </div>
  );
};
