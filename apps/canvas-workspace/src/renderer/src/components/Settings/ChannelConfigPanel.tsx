import { useCallback, useEffect, useState } from 'react';
import type { ChannelConfigStatus } from '../../types';
import { useAppShell } from '../AppShellProvider';
import './ChannelConfigPanel.css';

/**
 * Feishu credential editor shown under the "Chat channels" experimental
 * toggle. Lets the user configure FEISHU_APP_ID / FEISHU_APP_SECRET (and an
 * optional default workspace) from the UI instead of shell env vars. The
 * secret is stored encrypted in the main process and never echoed back.
 * Changes require a relaunch to take effect.
 */
export const ChannelConfigPanel = () => {
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
        notify({ tone: 'error', title: 'Save failed', description: res.error ?? 'Unknown error' });
        return;
      }
      if (res.status) setStatus(res.status);
      setAppSecret('');
      setDirty(false);
      setNeedsRelaunch(true);
      notify({ tone: 'success', title: 'Feishu credentials saved', description: 'Relaunch to apply.' });
    } catch (err) {
      notify({ tone: 'error', title: 'Save failed', description: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  }, [appId, appSecret, defaultWorkspaceId, notify]);

  const clearSecret = useCallback(async () => {
    const res = await window.canvasWorkspace.channelConfig.setFeishu({ clearSecret: true });
    if (res.ok) {
      if (res.status) setStatus(res.status);
      setAppSecret('');
      setNeedsRelaunch(true);
      notify({ tone: 'success', title: 'Secret cleared', description: 'Relaunch to apply.' });
    } else {
      notify({ tone: 'error', title: 'Clear failed', description: res.error ?? 'Unknown error' });
    }
  }, [notify]);

  const relaunch = useCallback(() => {
    void window.canvasWorkspace.channelConfig.relaunch();
  }, []);

  const onChange = (setter: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setter(e.target.value);
    setDirty(true);
  };

  if (loading) {
    return <div className="channel-config-panel">Loading…</div>;
  }

  const feishu = status?.feishu;
  const secretPlaceholder = feishu?.secretPresent ? '•••••••• (saved — leave blank to keep)' : 'Enter app secret';

  return (
    <div className="channel-config-panel">
      <div className="channel-config-title">Feishu credentials</div>
      <div className="channel-config-hint">
        Configure the Feishu app here instead of shell env vars. Stored locally; the secret is
        encrypted. Env vars (FEISHU_APP_ID / FEISHU_APP_SECRET), if set, take precedence.
      </div>

      <label className="channel-config-field">
        <span>App ID</span>
        <input
          type="text"
          value={appId}
          placeholder="cli_xxxxxxxx"
          onChange={onChange(setAppId)}
          spellCheck={false}
          autoComplete="off"
        />
        {feishu?.appIdFromEnv && <small className="channel-config-env">Overridden by FEISHU_APP_ID env var</small>}
      </label>

      <label className="channel-config-field">
        <span>App Secret</span>
        <input
          type="password"
          value={appSecret}
          placeholder={secretPlaceholder}
          onChange={onChange(setAppSecret)}
          spellCheck={false}
          autoComplete="off"
        />
        {feishu?.secretFromEnv && <small className="channel-config-env">Overridden by FEISHU_APP_SECRET env var</small>}
      </label>

      <label className="channel-config-field">
        <span>Default workspace id <span className="channel-config-optional">(optional)</span></span>
        <input
          type="text"
          value={defaultWorkspaceId}
          placeholder="most-recently-modified workspace if blank"
          onChange={onChange(setDefaultWorkspaceId)}
          spellCheck={false}
          autoComplete="off"
        />
        {feishu?.defaultWorkspaceFromEnv && (
          <small className="channel-config-env">Overridden by CANVAS_FEISHU_DEFAULT_WORKSPACE env var</small>
        )}
      </label>

      <div className="channel-config-actions">
        <button type="button" className="channel-config-btn channel-config-btn--primary" onClick={() => void save()} disabled={saving || !dirty}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        {feishu?.secretPresent && !feishu?.secretFromEnv && (
          <button type="button" className="channel-config-btn" onClick={() => void clearSecret()}>
            Clear secret
          </button>
        )}
      </div>

      {needsRelaunch && (
        <div className="channel-config-relaunch">
          <span>Relaunch Canvas to apply.</span>
          <button type="button" className="channel-config-btn channel-config-btn--primary" onClick={relaunch}>
            Relaunch now
          </button>
        </div>
      )}

      {status?.path && (
        <div className="channel-config-path">
          Stored at <code>{status.path}</code>
        </div>
      )}
    </div>
  );
};
