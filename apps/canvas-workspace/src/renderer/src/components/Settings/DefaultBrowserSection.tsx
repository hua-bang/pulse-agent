import { useCallback, useEffect, useState } from 'react';
import type { DefaultBrowserStatus } from '../../types';
import { useAppShell } from '../AppShellProvider';
import { useI18n } from '../../i18n';
import { Button } from '../ui';
import './DefaultBrowserSection.css';

export const DefaultBrowserSection = () => {
  const { notify } = useAppShell();
  const { t } = useI18n();
  const [status, setStatus] = useState<DefaultBrowserStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setStatus(await window.canvasWorkspace.defaultBrowser.status());
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = useCallback(
    async (enabled: boolean) => {
      setPending(true);
      // Optimistic flip so the switch feels responsive; reconciled below.
      setStatus((s) => (s ? { ...s, isDefault: enabled } : s));
      try {
        const next = await window.canvasWorkspace.defaultBrowser.set(enabled);
        setStatus(next);
        if (enabled && !next.isDefault) {
          // Registration was requested but the OS still needs the user to
          // confirm the switch in System Settings.
          notify({
            tone: 'info',
            title: t('settings.defaultBrowser.osHintTitle'),
            description: t('settings.defaultBrowser.osHint'),
          });
        }
      } catch (err) {
        await load();
        notify({
          tone: 'error',
          title: t('settings.defaultBrowser.updateFailed'),
          description: err instanceof Error ? err.message : String(err),
        });
      } finally {
        setPending(false);
      }
    },
    [load, notify, t],
  );

  const enabled = !!status?.isDefault;

  return (
    <div className="default-browser-section">
      <div className="default-browser-section-scroll">
        <div className="default-browser-section-intro">
          <div className="default-browser-section-intro-title">
            {t('settings.defaultBrowser.introTitle')}
          </div>
          <div className="default-browser-section-intro-desc">
            {t('settings.defaultBrowser.introDescription')}
          </div>
        </div>

        <div className="default-browser-section-card">
          <div className="default-browser-section-card-body">
            <div className="default-browser-section-card-label">
              {t('settings.defaultBrowser.toggleLabel')}
            </div>
            <div className="default-browser-section-card-status">
              {loading
                ? t('settings.defaultBrowser.loading')
                : enabled
                  ? t('settings.defaultBrowser.statusDefault')
                  : t('settings.defaultBrowser.statusNotDefault')}
            </div>
          </div>
          <label
            className={`default-browser-section-switch${enabled ? ' default-browser-section-switch--on' : ''}${pending || loading ? ' default-browser-section-switch--busy' : ''}`}
          >
            <input
              type="checkbox"
              checked={enabled}
              disabled={pending || loading}
              onChange={(e) => void toggle(e.target.checked)}
              aria-label={t('settings.defaultBrowser.toggleLabel')}
            />
            <span className="default-browser-section-switch-track" aria-hidden>
              <span className="default-browser-section-switch-thumb" />
            </span>
          </label>
        </div>

        <div className="default-browser-section-hint">
          {t('settings.defaultBrowser.osHint')}
        </div>

        {status && !status.isPackaged && (
          <div className="default-browser-section-warning">
            {t('settings.defaultBrowser.devWarning')}
          </div>
        )}
      </div>

      <div className="default-browser-section-footer">
        <Button variant="secondary" size="sm" onClick={() => void load()} disabled={loading}>
          {t('settings.defaultBrowser.recheck')}
        </Button>
      </div>
    </div>
  );
};
