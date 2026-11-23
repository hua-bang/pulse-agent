import { useCallback, useEffect, useState } from 'react';
import type { RemoteVpsWorkspaceConfigDto } from '../../../../../../shared/api/remote-vps';
import { Button, FieldRow, SegmentedControl, TextField } from '../../../../components/ui';
import { useI18n } from '../../../../i18n';
import './RemoteVpsCard.css';

interface Props {
  workspaceId: string;
  currentConfig: RemoteVpsWorkspaceConfigDto | null;
  onConfigChange: (config: RemoteVpsWorkspaceConfigDto | null) => void;
}

type ConnMode = 'ssh' | 'direct';
type ScopeMode = 'full' | 'runtime-only';

export const RemoteVpsCard = ({ workspaceId, currentConfig, onConfigChange }: Props) => {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(!currentConfig);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [sshHosts, setSshHosts] = useState<string[]>([]);

  const [connMode, setConnMode] = useState<ConnMode>('ssh');
  const [scopeMode, setScopeMode] = useState<ScopeMode>('full');
  const [sshHost, setSshHost] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [remotePort, setRemotePort] = useState('4770');
  const [token, setToken] = useState('');

  const [busy, setBusy] = useState<'connect' | 'migrate' | 'remove' | null>(null);
  const [statusMsg, setStatusMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const bound = Boolean(currentConfig);

  useEffect(() => {
    const api = window.canvasWorkspace?.remoteVps;
    if (!api) return;
    let cancelled = false;
    void api.listSshHosts().then((res) => {
      if (!cancelled && res.ok) setSshHosts(res.hosts);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setStatusMsg(null);
    if (currentConfig) {
      setExpanded(false);
      setConnMode(currentConfig.endpoint ? 'direct' : 'ssh');
      setScopeMode(currentConfig.storage === 'local' ? 'runtime-only' : 'full');
      setSshHost(currentConfig.sshHost ?? '');
      setEndpoint(currentConfig.endpoint ?? '');
      setRemotePort(String(currentConfig.remotePort ?? 4770));
      setToken(currentConfig.token ?? '');
    } else {
      setExpanded(true);
      setConnMode('ssh');
      setScopeMode('full');
      setSshHost('');
      setEndpoint('');
      setRemotePort('4770');
      setToken('');
    }
  }, [currentConfig, workspaceId]);

  const buildDraftConfig = useCallback((): RemoteVpsWorkspaceConfigDto => {
    const portNum = Number.parseInt(remotePort, 10);
    return {
      kind: 'vps',
      ...(connMode === 'ssh'
        ? {
            sshHost: sshHost.trim(),
            remotePort: Number.isFinite(portNum) && portNum > 0 ? portNum : 4770,
            autoBootstrap: true,
          }
        : {
            endpoint: endpoint.trim().replace(/\/+$/, ''),
            autoBootstrap: false,
          }),
      token: token.trim() || undefined,
      remoteWorkspaceId: currentConfig?.remoteWorkspaceId || workspaceId,
      cwd: currentConfig?.cwd?.trim() || undefined,
      storage: scopeMode === 'full' ? 'vps' : 'local',
      runtime: 'vps',
    };
  }, [connMode, sshHost, remotePort, endpoint, token, scopeMode, currentConfig, workspaceId]);

  const canSubmit =
    connMode === 'ssh'
      ? sshHost.trim().length > 0
      : endpoint.trim().length > 0 && token.trim().length > 0;

  const handleConnectAndSave = async () => {
    const api = window.canvasWorkspace?.remoteVps;
    if (!api) return;
    setBusy('connect');
    setStatusMsg(null);
    try {
      const draft = buildDraftConfig();
      const testRes = await api.testAndBootstrap(workspaceId, draft);
      if (!testRes.ok) {
        setStatusMsg({ kind: 'err', text: testRes.error || t('remoteVps.connectFailed') });
        return;
      }
      const resolvedConfig: RemoteVpsWorkspaceConfigDto = {
        ...draft,
        token: testRes.token || draft.token,
      };
      if (testRes.token) setToken(testRes.token);

      const saveRes = await api.saveConfig(workspaceId, resolvedConfig);
      if (!saveRes.ok) {
        setStatusMsg({ kind: 'err', text: saveRes.error || t('remoteVps.connectFailed') });
        return;
      }
      onConfigChange(resolvedConfig);
      setStatusMsg({
        kind: 'ok',
        text: testRes.uploaded
          ? t('remoteVps.connectedUploaded', { version: testRes.version ?? '0.1.0' })
          : t('remoteVps.connectedOk', { version: testRes.version ?? '0.1.0' }),
      });
    } finally {
      setBusy(null);
    }
  };

  const handleMigrate = async () => {
    const api = window.canvasWorkspace?.remoteVps;
    if (!api) return;
    setBusy('migrate');
    setStatusMsg(null);
    try {
      const draft = buildDraftConfig();
      const testRes = await api.testAndBootstrap(workspaceId, draft);
      if (!testRes.ok) {
        setStatusMsg({ kind: 'err', text: testRes.error || t('remoteVps.migrateFailed') });
        return;
      }
      const resolvedDraft: RemoteVpsWorkspaceConfigDto = {
        ...draft,
        token: testRes.token || draft.token,
        storage: 'vps',
      };
      if (testRes.token) setToken(testRes.token);

      const migRes = await api.migrateLocal(workspaceId, resolvedDraft);
      if (!migRes.ok) {
        setStatusMsg({ kind: 'err', text: migRes.error || t('remoteVps.migrateFailed') });
        return;
      }
      await api.saveConfig(workspaceId, resolvedDraft);
      onConfigChange(resolvedDraft);
      setStatusMsg({
        kind: 'ok',
        text: t('remoteVps.migratedOk', {
          conversations: String(migRes.conversationCount ?? 0),
          files: String(migRes.uploadedFiles ?? 0),
        }),
      });
    } finally {
      setBusy(null);
    }
  };

  const handleRemove = async () => {
    const api = window.canvasWorkspace?.remoteVps;
    if (!api) return;
    setBusy('remove');
    setStatusMsg(null);
    try {
      const res = await api.removeConfig(workspaceId);
      if (!res.ok) {
        setStatusMsg({ kind: 'err', text: res.error || t('remoteVps.unbindFailed') });
        return;
      }
      onConfigChange(null);
      setStatusMsg({ kind: 'ok', text: t('remoteVps.unboundOk') });
    } finally {
      setBusy(null);
    }
  };

  const hostSummary = currentConfig?.sshHost || currentConfig?.endpoint || '';

  return (
    <div className="remote-vps-panel">
      {bound && (
        <div className="remote-vps-summary">
          <div className="remote-vps-summary-left">
            <span className="remote-vps-dot" aria-hidden="true" />
            <span className="remote-vps-host" title={hostSummary}>{hostSummary}</span>
            <span className="remote-vps-badge is-bound">
              {currentConfig?.storage === 'local'
                ? t('remoteVps.boundRuntime')
                : t('remoteVps.boundFull')}
            </span>
          </div>
          <Button variant="secondary" size="sm" onClick={() => setExpanded((prev) => !prev)}>
            {expanded ? t('remoteVps.collapse') : t('remoteVps.manageConnection')}
          </Button>
        </div>
      )}

      {expanded && (
        <div className="remote-vps-body">
          {connMode === 'ssh' ? (
            <FieldRow label={t('remoteVps.sshHost')} hint={t('remoteVps.sshHostHint')}>
              <TextField
                value={sshHost}
                onChange={(e) => setSshHost(e.target.value)}
                placeholder={t('remoteVps.sshHostPlaceholder')}
              />
              {sshHosts.length > 0 && (
                <div className="remote-vps-host-chips">
                  {sshHosts.slice(0, 8).map((host) => (
                    <Button
                      key={host}
                      variant="secondary"
                      size="sm"
                      onClick={() => setSshHost(host)}
                    >
                      {host}
                    </Button>
                  ))}
                </div>
              )}
            </FieldRow>
          ) : (
            <FieldRow label={t('remoteVps.endpoint')} hint={t('remoteVps.endpointHint')}>
              <TextField
                value={endpoint}
                onChange={(e) => setEndpoint(e.target.value)}
                placeholder="http://100.x.y.z:4770"
              />
            </FieldRow>
          )}

          <div className="remote-vps-advanced-toggle">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setShowAdvanced((prev) => !prev)}
            >
              {showAdvanced ? t('remoteVps.advancedHide') : t('remoteVps.advancedShow')}
            </Button>
          </div>

          {showAdvanced && (
            <div className="remote-vps-advanced">
              <FieldRow
                label={t('remoteVps.connMode')}
                hint={connMode === 'ssh' ? t('remoteVps.connSshHint') : t('remoteVps.connDirectHint')}
              >
                <SegmentedControl
                  value={connMode}
                  onChange={(id) => setConnMode(id as ConnMode)}
                  options={[
                    { id: 'ssh', label: t('remoteVps.connSsh') },
                    { id: 'direct', label: t('remoteVps.connDirect') },
                  ]}
                />
              </FieldRow>

              <FieldRow label={t('remoteVps.scopeMode')} hint={t('remoteVps.scopeHint')}>
                <SegmentedControl
                  value={scopeMode}
                  onChange={(id) => setScopeMode(id as ScopeMode)}
                  options={[
                    { id: 'full', label: t('remoteVps.scopeFull') },
                    { id: 'runtime-only', label: t('remoteVps.scopeRuntime') },
                  ]}
                />
              </FieldRow>

              {connMode === 'ssh' && (
                <FieldRow label={t('remoteVps.remotePort')} hint={t('remoteVps.remotePortHint')}>
                  <TextField
                    value={remotePort}
                    onChange={(e) => setRemotePort(e.target.value)}
                    placeholder="4770"
                  />
                </FieldRow>
              )}

              <FieldRow
                label={t('remoteVps.token')}
                hint={connMode === 'ssh' ? t('remoteVps.tokenHintSsh') : t('remoteVps.tokenHintDirect')}
              >
                <TextField
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder={
                    connMode === 'ssh'
                      ? t('remoteVps.tokenPlaceholderSsh')
                      : t('remoteVps.tokenPlaceholderDirect')
                  }
                />
              </FieldRow>
            </div>
          )}

          {statusMsg && (
            <div className={`remote-vps-status ${statusMsg.kind === 'err' ? 'is-error' : 'is-ok'}`}>
              {statusMsg.text}
            </div>
          )}

          <div className="remote-vps-actions">
            <Button
              variant={bound ? 'secondary' : 'primary'}
              disabled={!canSubmit || busy !== null}
              onClick={() => void handleConnectAndSave()}
            >
              {busy === 'connect'
                ? t('remoteVps.connecting')
                : bound
                  ? t('remoteVps.reconnectAndSave')
                  : t('remoteVps.connectAndEnable')}
            </Button>
            {bound && scopeMode === 'full' && (
              <Button
                variant="secondary"
                disabled={!canSubmit || busy !== null}
                onClick={() => void handleMigrate()}
              >
                {busy === 'migrate' ? t('remoteVps.migrating') : t('remoteVps.migrateLocal')}
              </Button>
            )}
            {bound && (
              <Button
                variant="secondary"
                disabled={busy !== null}
                onClick={() => void handleRemove()}
              >
                {busy === 'remove' ? t('remoteVps.unbinding') : t('remoteVps.unbind')}
              </Button>
            )}
          </div>
        </div>
      )}

      {!expanded && statusMsg && (
        <div className={`remote-vps-status ${statusMsg.kind === 'err' ? 'is-error' : 'is-ok'}`}>
          {statusMsg.text}
        </div>
      )}
    </div>
  );
};
