import { useCallback, useEffect, useState } from 'react';
import type { RemoteVpsWorkspaceConfigDto } from '../../../../../../shared/api/remote-vps';
import { Button, FieldRow, SegmentedControl, TextField } from '../../../../components/ui';
import { useI18n } from '../../../../i18n';
import { remoteShareCopy, remoteVpsCopy } from '../../components/RemoteFolderPickerModal/copy';
import { RemoteVpsSharePanel } from './RemoteVpsSharePanel';
import './RemoteVpsCard.css';

interface Props {
  workspaceId: string;
  currentConfig: RemoteVpsWorkspaceConfigDto | null;
  onConfigChange: (config: RemoteVpsWorkspaceConfigDto | null) => void;
}

type ConnMode = 'ssh' | 'direct';
type ScopeMode = 'full' | 'runtime-only';
type SetupMode = 'own' | 'invite';

export const RemoteVpsCard = ({ workspaceId, currentConfig, onConfigChange }: Props) => {
  const { language } = useI18n();
  const copy = remoteVpsCopy(language);
  const shareCopy = remoteShareCopy(language);
  const [expanded, setExpanded] = useState(!currentConfig);
  const [shareOpen, setShareOpen] = useState(false);
  const [setupMode, setSetupMode] = useState<SetupMode>('own');
  const [inviteCode, setInviteCode] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [sshHosts, setSshHosts] = useState<string[]>([]);

  const [connMode, setConnMode] = useState<ConnMode>('ssh');
  const [scopeMode, setScopeMode] = useState<ScopeMode>('full');
  const [sshHost, setSshHost] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [remotePort, setRemotePort] = useState('4770');
  const [token, setToken] = useState('');

  const [busy, setBusy] = useState<'connect' | 'migrate' | 'remove' | 'join' | null>(null);
  const [statusMsg, setStatusMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const bound = Boolean(currentConfig);
  const isSharedGuest = Boolean(currentConfig?.shareRole);

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
    setShareOpen(false);
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
      setSetupMode('own');
      setInviteCode('');
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

  const handleJoinInvite = async () => {
    const api = window.canvasWorkspace?.remoteVps;
    if (!api || !inviteCode.trim()) return;
    setBusy('join');
    setStatusMsg(null);
    try {
      const res = await api.joinShare(workspaceId, inviteCode.trim());
      if (!res.ok || !res.config) {
        setStatusMsg({ kind: 'err', text: res.error || shareCopy.joinFailed });
        return;
      }
      onConfigChange(res.config);
      setInviteCode('');
      setStatusMsg({ kind: 'ok', text: shareCopy.joinedOk(res.role ?? 'viewer') });
    } finally {
      setBusy(null);
    }
  };

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

      const saveRes = await api.saveConfig(workspaceId, resolvedConfig);
      if (!saveRes.ok) {
        setStatusMsg({ kind: 'err', text: saveRes.error || copy.connectFailed });
        return;
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
            <span className="remote-vps-dot" aria-hidden="true" />
            <span className="remote-vps-host" title={hostSummary}>{hostSummary}</span>
            <span className="remote-vps-badge is-bound">
              {currentConfig?.shareRole
                ? shareCopy.sharedBadge(currentConfig.shareRole)
                : currentConfig?.storage === 'local'
                  ? copy.boundRuntime
                  : copy.boundFull}
            </span>
          </div>
          <div className="remote-vps-summary-actions">
            {!isSharedGuest && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setShareOpen((prev) => !prev);
                  setExpanded(false);
                }}
              >
                {shareOpen ? shareCopy.shareHide : shareCopy.shareButton}
              </Button>
            )}
            {isSharedGuest ? (
              <Button variant="secondary" size="sm" disabled={busy !== null} onClick={() => void handleRemove()}>
                {busy === 'remove' ? copy.unbinding : copy.unbind}
              </Button>
            ) : (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setExpanded((prev) => !prev);
                  setShareOpen(false);
                }}
              >
                {expanded ? copy.collapse : copy.manageConnection}
              </Button>
            )}
          </div>
        </div>
      )}

      {bound && shareOpen && !isSharedGuest && (
        <RemoteVpsSharePanel
          workspaceId={workspaceId}
          defaultEndpoint={currentConfig?.endpoint}
        />
      )}

      {expanded && !bound && (
        <SegmentedControl
          value={setupMode}
          onChange={(id) => setSetupMode(id as SetupMode)}
          options={[
            { id: 'own', label: shareCopy.connectOwnTab },
            { id: 'invite', label: shareCopy.joinInviteTab },
          ]}
        />
      )}

      {expanded && !bound && setupMode === 'invite' && (
        <div className="remote-vps-body">
          <FieldRow label={shareCopy.inviteCodeLabel} hint={shareCopy.inviteCodeHint}>
            <TextField
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              placeholder={shareCopy.inviteCodePlaceholder}
            />
          </FieldRow>
          {statusMsg && (
            <div className={`remote-vps-status ${statusMsg.kind === 'err' ? 'is-error' : 'is-ok'}`}>
              {statusMsg.text}
            </div>
          )}
          <div className="remote-vps-actions">
            <Button
              variant="primary"
              disabled={!inviteCode.trim() || busy !== null}
              onClick={() => void handleJoinInvite()}
            >
              {busy === 'join' ? shareCopy.joining : shareCopy.joinAction}
            </Button>
          </div>
        </div>
      )}

      {expanded && (bound || setupMode === 'own') && (
        <div className="remote-vps-body">
          {connMode === 'ssh' ? (
            <FieldRow label={copy.sshHost} hint={copy.sshHostHint}>
              <TextField
                value={sshHost}
                onChange={(e) => setSshHost(e.target.value)}
                placeholder={copy.sshHostPlaceholder}
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
            <FieldRow label={copy.endpoint} hint={copy.endpointHint}>
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
              {showAdvanced ? copy.advancedHide : copy.advancedShow}
            </Button>
          </div>

          {showAdvanced && (
            <div className="remote-vps-advanced">
              <FieldRow
                label={copy.connMode}
                hint={connMode === 'ssh' ? copy.connSshHint : copy.connDirectHint}
              >
                <SegmentedControl
                  value={connMode}
                  onChange={(id) => setConnMode(id as ConnMode)}
                  options={[
                    { id: 'ssh', label: copy.connSsh },
                    { id: 'direct', label: copy.connDirect },
                  ]}
                />
              </FieldRow>

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

              {connMode === 'ssh' && (
                <FieldRow label={copy.remotePort} hint={copy.remotePortHint}>
                  <TextField
                    value={remotePort}
                    onChange={(e) => setRemotePort(e.target.value)}
                    placeholder="4770"
                  />
                </FieldRow>
              )}

              <FieldRow
                label={copy.token}
                hint={connMode === 'ssh' ? copy.tokenHintSsh : copy.tokenHintDirect}
              >
                <TextField
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder={
                    connMode === 'ssh' ? copy.tokenPlaceholderSsh : copy.tokenPlaceholderDirect
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
