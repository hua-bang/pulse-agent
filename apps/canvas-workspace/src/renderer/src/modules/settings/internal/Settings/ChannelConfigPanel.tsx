import { useCallback, useEffect, useState } from 'react';
import type { ChannelConfigStatus } from '../../../../types';
import { useAppShell } from '../../../../shared/appShell';
import { useI18n } from '../../../../i18n';
import './ChannelConfigPanel.css';

/**
 * Feishu credential editor shown under the "Feishu Bot" experimental
 * toggle. Lets the user configure FEISHU_APP_ID / FEISHU_APP_SECRET (and an
 * optional default workspace) from the UI instead of shell env vars. The
 * secret is stored encrypted in the main process and never echoed back.
 * Changes require a relaunch to take effect.
 */
export const ChannelConfigPanel = () => {
  const { t } = useI18n();
  const { notify } = useAppShell();
  const [status, setStatus] = useState<ChannelConfigStatus | null>(null);
  const [appId, setAppId] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [defaultWorkspaceId, setDefaultWorkspaceId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [needsRelaunch, setNeedsRelaunch] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await window.canvasWorkspace.channelConfig.status();
      if (res.ok && res.status) {
        setStatus(res.status);
        setAppId(res.status.feishu.appId ?? '');
        setDefaultWorkspaceId(res.status.feishu.defaultWorkspaceId ?? '');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const res = await window.canvasWorkspace.channelConfig.setFeishu({
        appId,
        // Only send the secret when the user typed a new one; an empty
        // field leaves the stored secret untouched.
        appSecret: appSecret.trim() ? appSecret : undefined,
        defaultWorkspaceId,
      });
      if (!res.ok) {
        notify({ tone: 'error', title: t('channelConfig.saveFailed'), description: res.error ?? t('channelConfig.unknownError') });
        return;
      }
      if (res.status) setStatus(res.status);
      setAppSecret('');
      setDirty(false);
      setNeedsRelaunch(true);
      notify({ tone: 'success', title: t('channelConfig.saved'), description: t('channelConfig.relaunchToApply') });
    } catch (err) {
      notify({ tone: 'error', title: t('channelConfig.saveFailed'), description: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  }, [appId, appSecret, defaultWorkspaceId, notify, t]);

  const clearSecret = useCallback(async () => {
    const res = await window.canvasWorkspace.channelConfig.setFeishu({ clearSecret: true });
    if (res.ok) {
      if (res.status) setStatus(res.status);
      setAppSecret('');
      setNeedsRelaunch(true);
      notify({ tone: 'success', title: t('channelConfig.secretCleared'), description: t('channelConfig.relaunchToApply') });
    } else {
      notify({ tone: 'error', title: t('channelConfig.clearFailed'), description: res.error ?? t('channelConfig.unknownError') });
    }
  }, [notify, t]);

  const relaunch = useCallback(() => {
    void window.canvasWorkspace.channelConfig.relaunch();
  }, []);

  const onChange = (setter: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setter(e.target.value);
    setDirty(true);
  };

  if (loading) {
    return <div className="channel-config-panel">{t('channelConfig.loading')}</div>;
  }

  const feishu = status?.feishu;
  const secretPlaceholder = feishu?.secretPresent
    ? t('channelConfig.secretSavedPlaceholder')
    : t('channelConfig.secretPlaceholder');

  return (
    <div className="channel-config-panel">
      <div className="channel-config-title">{t('channelConfig.title')}</div>
      <div className="channel-config-hint">{t('channelConfig.hint')}</div>

      <label className="channel-config-field">
        <span>{t('channelConfig.appId')}</span>
        <input
          type="text"
          value={appId}
          placeholder="cli_xxxxxxxx"
          onChange={onChange(setAppId)}
          spellCheck={false}
          autoComplete="off"
        />
        {feishu?.appIdFromEnv && <small className="channel-config-env">{t('channelConfig.overriddenByEnv', { name: 'FEISHU_APP_ID' })}</small>}
      </label>

      <label className="channel-config-field">
        <span>{t('channelConfig.appSecret')}</span>
        <input
          type="password"
          value={appSecret}
          placeholder={secretPlaceholder}
          onChange={onChange(setAppSecret)}
          spellCheck={false}
          autoComplete="off"
        />
        {feishu?.secretFromEnv && <small className="channel-config-env">{t('channelConfig.overriddenByEnv', { name: 'FEISHU_APP_SECRET' })}</small>}
      </label>

      <label className="channel-config-field">
        <span>
          {t('channelConfig.defaultWorkspace')}{' '}
          <span className="channel-config-optional">{t('channelConfig.optional')}</span>
        </span>
        <input
          type="text"
          value={defaultWorkspaceId}
          placeholder={t('channelConfig.defaultWorkspacePlaceholder')}
          onChange={onChange(setDefaultWorkspaceId)}
          spellCheck={false}
          autoComplete="off"
        />
        {feishu?.defaultWorkspaceFromEnv && (
          <small className="channel-config-env">
            {t('channelConfig.overriddenByEnv', { name: 'CANVAS_FEISHU_DEFAULT_WORKSPACE' })}
          </small>
        )}
      </label>

      <div className="channel-config-actions">
        <button type="button" className="channel-config-btn channel-config-btn--primary" onClick={() => void save()} disabled={saving || !dirty}>
          {saving ? t('channelConfig.saving') : t('channelConfig.save')}
        </button>
        {feishu?.secretPresent && !feishu?.secretFromEnv && (
          <button type="button" className="channel-config-btn" onClick={() => void clearSecret()}>
            {t('channelConfig.clearSecret')}
          </button>
        )}
      </div>

      {needsRelaunch && (
        <div className="channel-config-relaunch">
          <span>{t('channelConfig.relaunchHint')}</span>
          <button type="button" className="channel-config-btn channel-config-btn--primary" onClick={relaunch}>
            {t('channelConfig.relaunchNow')}
          </button>
        </div>
      )}

      {status?.path && (
        <div className="channel-config-path">
          {t('channelConfig.storedAt')} <code>{status.path}</code>
        </div>
      )}
    </div>
  );
};
