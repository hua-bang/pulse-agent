import { useCallback, useEffect, useState } from 'react';
import type {
  RemoteVpsStatusResult,
  RemoteVpsWorkspaceConfigDto,
} from '../../../../../../shared/api/remote-vps';
import { Button, FieldRow, SegmentedControl, TextField } from '../../../../components/ui';
import { useI18n } from '../../../../i18n';
import { remoteShareCopy, remoteVpsCopy } from '../../components/RemoteFolderPickerModal/copy';
import './RemoteVpsCard.css';

interface Props {
  workspaceId: string;
  currentConfig: RemoteVpsWorkspaceConfigDto | null;
  onConfigChange: (config: RemoteVpsWorkspaceConfigDto | null) => void;
}

type ScopeMode = 'full' | 'runtime-only';

function isDirectUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

export const RemoteVpsCard = ({ workspaceId, currentConfig, onConfigChange }: Props) => {
  const { language } = useI18n();
  const copy = remoteVpsCopy(language);
  const shareCopy = remoteShareCopy(language);
  const [expanded, setExpanded] = useState(!currentConfig);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [sshHosts, setSshHosts] = useState<string[]>([]);
  const [liveStatus, setLiveStatus] = useState<RemoteVpsStatusResult | null>(null);

  const [targetInput, setTargetInput] = useState('');
  const [scopeMode, setScopeMode] = useState<ScopeMode>('full');
  const [remotePort, setRemotePort] = useState('4770');
  const [token, setToken] = useState('');
  const [allowRelay, setAllowRelay] = useState(true);

  const [busy, setBusy] = useState<'connect' | 'migrate' | 'remove' | null>(null);
  const [statusMsg, setStatusMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const bound = Boolean(currentConfig);
  const isSharedGuest = Boolean(currentConfig?.shareRole);
  const directMode = isDirectUrl(targetInput);

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
    setLiveStatus(null);
    if (currentConfig) {
      setExpanded(false);
      setTargetInput(currentConfig.endpoint || currentConfig.sshHost || '');
      setScopeMode(currentConfig.storage === 'local' ? 'runtime-only' : 'full');
      setRemotePort(String(currentConfig.remotePort ?? 4770));
      setToken(currentConfig.token ?? '');
      setAllowRelay(currentConfig.allowCapabilityRelay !== false);
      const api = window.canvasWorkspace?.remoteVps;
      if (api) {
        let cancelled = false;
        void api.getStatus(workspaceId).then((res) => {
          if (!cancelled) setLiveStatus(res);
        });
        return () => {
          cancelled = true;
        };
      }
    } else {
      setExpanded(true);
      setTargetInput('');
      setScopeMode('full');
      setRemotePort('4770');
      setToken('');
      setAllowRelay(true);
    }
    return undefined;
  }, [currentConfig, workspaceId]);

  const buildDraftConfig = useCallback((): RemoteVpsWorkspaceConfigDto => {
    const trimmed = targetInput.trim();
    const portNum = Number.parseInt(remotePort, 10);
    return {
      kind: 'vps',
      ...(isDirectUrl(trimmed)
        ? {
            endpoint: trimmed.replace(/\/+$/, ''),
            autoBootstrap: false,
          }
        : {
            sshHost: trimmed,
            remotePort: Number.isFinite(portNum) && portNum > 0 ? portNum : 4770,
            autoBootstrap: true,
          }),
      token: token.trim() || undefined,
      remoteWorkspaceId: currentConfig?.remoteWorkspaceId || workspaceId,
      cwd: currentConfig?.cwd?.trim() || undefined,
      storage: scopeMode === 'full' ? 'vps' : 'local',
      runtime: 'vps',
      allowCapabilityRelay: allowRelay,
    };
  }, [targetInput, remotePort, token, scopeMode, allowRelay, currentConfig, workspaceId]);

  const canSubmit = directMode
    ? targetInput.trim().length > 0 && token.trim().length > 0
    : targetInput.trim().length > 0;

  const handleConnectAndSave = async () => {
    const api = window.canvasWorkspace?.remoteVps;
    if (!api) return;
    setBusy('connect');
    setStatusMsg(null);
    try {
      const draft = buildDraftConfig();
      const testRes = await api.testAndBootstrap(workspaceId, draft);
      if (!testRes.ok) {
        setStatusMsg({ kind: 'err', text: testRes.error || copy.connectFailed });
        return;
      }
      const resolvedConfig: RemoteVpsWorkspaceConfigDto = {
        ...draft,
        token: testRes.token || draft.token,
      };
      if (testRes.token) setToken(testRes.token);

      if (!bound && resolvedConfig.storage === 'vps') {
        const autoMig = await api.migrateLocal(workspaceId, resolvedConfig, {
          onlyIfRemoteEmpty: true,
        });
        if (!autoMig.ok) {
          const saveRes = await api.saveConfig(workspaceId, resolvedConfig);
          if (!saveRes.ok) {
            setStatusMsg({ kind: 'err', text: saveRes.error || copy.connectFailed });
            return;
          }
        }
      } else {
        const saveRes = await api.saveConfig(workspaceId, resolvedConfig);
        if (!saveRes.ok) {
          setStatusMsg({ kind: 'err', text: saveRes.error || copy.connectFailed });
          return;
        }
      }
      onConfigChange(resolvedConfig);
      setStatusMsg({
        kind: 'ok',
        text: testRes.uploaded
          ? copy.connectedUploaded(testRes.version ?? '0.1.0')
          : copy.connectedOk(testRes.version ?? '0.1.0'),
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
        setStatusMsg({ kind: 'err', text: testRes.error || copy.migrateFailed });
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
        setStatusMsg({ kind: 'err', text: migRes.error || copy.migrateFailed });
        return;
      }
      await api.saveConfig(workspaceId, resolvedDraft);
      onConfigChange(resolvedDraft);
      setStatusMsg({
        kind: 'ok',
        text: copy.migratedOk(migRes.conversationCount ?? 0, migRes.uploadedFiles ?? 0),
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
        setStatusMsg({ kind: 'err', text: res.error || copy.unbindFailed });
        return;
      }
      onConfigChange(null);
      setStatusMsg({ kind: 'ok', text: copy.unboundOk });
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
            <span
              className={`remote-vps-dot${liveStatus && !liveStatus.connected ? ' is-offline' : ''}`}
              aria-hidden="true"
            />
            <span className="remote-vps-host" title={hostSummary}>{hostSummary}</span>
            <span className="remote-vps-badge is-bound">
              {liveStatus && !liveStatus.connected
                ? shareCopy.offlineBadge
                : currentConfig?.shareRole
                  ? shareCopy.sharedBadge(currentConfig.shareRole)
                  : currentConfig?.storage === 'local'
                    ? copy.boundRuntime
                    : copy.boundFull}
            </span>
          </div>
          <div className="remote-vps-summary-actions">
            {isSharedGuest ? (
              <Button variant="secondary" size="sm" disabled={busy !== null} onClick={() => void handleRemove()}>
                {busy === 'remove' ? copy.unbinding : copy.unbind}
              </Button>
            ) : (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setExpanded((prev) => !prev)}
              >
                {expanded ? copy.collapse : copy.manageConnection}
              </Button>
            )}
          </div>
        </div>
      )}

      {bound && currentConfig?.shareRole === 'viewer' && (
        <div className="remote-vps-banner">{shareCopy.viewerReadOnlyNotice}</div>
      )}

      {bound && liveStatus?.outdatedDaemon && !isSharedGuest && Boolean(currentConfig?.sshHost) && (
        <div className="remote-vps-banner">
          <span>{shareCopy.outdatedBanner}</span>
          <Button variant="secondary" size="sm" disabled={busy !== null} onClick={() => void handleConnectAndSave()}>
            {busy === 'connect' ? shareCopy.upgrading : shareCopy.upgradeNow}
          </Button>
        </div>
      )}

      {expanded && !isSharedGuest && (
        <div className="remote-vps-body">
          <FieldRow label={copy.sshHost} hint={copy.sshHostHint}>
            <TextField
              value={targetInput}
              onChange={(e) => setTargetInput(e.target.value)}
              placeholder={copy.sshHostPlaceholder}
            />
            {!directMode && sshHosts.length > 0 && (
              <div className="remote-vps-host-chips">
                {sshHosts.slice(0, 8).map((host) => (
                  <Button
                    key={host}
                    variant="secondary"
                    size="sm"
                    onClick={() => setTargetInput(host)}
                  >
                    {host}
                  </Button>
                ))}
              </div>
            )}
          </FieldRow>

          {directMode && (
            <FieldRow label={copy.token} hint={copy.tokenHintDirect}>
              <TextField
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder={copy.tokenPlaceholderDirect}
              />
            </FieldRow>
          )}

          <div className="remote-vps-advanced-toggle">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setShowAdvanced((prev) => !prev)}
            >
              {showAdvanced ? copy.advancedHide : copy.advancedShow}
            </Button>
          </div>

          {showAdvanced && (
            <div className="remote-vps-advanced">
              <FieldRow label={copy.scopeMode} hint={copy.scopeHint}>
                <SegmentedControl
                  value={scopeMode}
                  onChange={(id) => setScopeMode(id as ScopeMode)}
                  options={[
                    { id: 'full', label: copy.scopeFull },
                    { id: 'runtime-only', label: copy.scopeRuntime },
                  ]}
                />
              </FieldRow>

              {!directMode && (
                <>
                  <FieldRow label={copy.remotePort} hint={copy.remotePortHint}>
                    <TextField
                      value={remotePort}
                      onChange={(e) => setRemotePort(e.target.value)}
                      placeholder="4770"
                    />
                  </FieldRow>

                  <FieldRow label={copy.token} hint={copy.tokenHintSsh}>
                    <TextField
                      type="password"
                      value={token}
                      onChange={(e) => setToken(e.target.value)}
                      placeholder={copy.tokenPlaceholderSsh}
                    />
                  </FieldRow>
                </>
              )}

              <FieldRow label={shareCopy.relayLabel} hint={shareCopy.relayHint}>
                <SegmentedControl
                  value={allowRelay ? 'on' : 'off'}
                  onChange={(id) => setAllowRelay(id === 'on')}
                  options={[
                    { id: 'on', label: shareCopy.relayOn },
                    { id: 'off', label: shareCopy.relayOff },
                  ]}
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
                ? copy.connecting
                : bound
                  ? copy.reconnectAndSave
                  : copy.connectAndEnable}
            </Button>
            {bound && scopeMode === 'full' && (
              <Button
                variant="secondary"
                disabled={!canSubmit || busy !== null}
                onClick={() => void handleMigrate()}
              >
                {busy === 'migrate' ? copy.migrating : copy.migrateLocal}
              </Button>
            )}
            {bound && (
              <Button
                variant="secondary"
                disabled={busy !== null}
                onClick={() => void handleRemove()}
              >
                {busy === 'remove' ? copy.unbinding : copy.unbind}
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
