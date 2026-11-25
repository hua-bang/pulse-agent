import { useEffect, useId, useState } from 'react';
import type {
  RemoteVpsStatusResult,
  RemoteVpsWorkspaceConfigDto,
} from '../../../../../../shared/api/remote-vps';
import { CloseIcon } from '../../../../components/icons';
import { Button, FieldRow, Modal, SegmentedControl, TextField } from '../../../../components/ui';
import { useI18n } from '../../../../i18n';
import { RemoteVpsSharePanel } from '../../internal/WorkspaceSettings/RemoteVpsSharePanel';
import { canvasShareCopy, remoteShareCopy } from '../RemoteFolderPickerModal/copy';
import './index.css';

interface Props {
  open: boolean;
  workspaceId: string;
  workspaceName: string;
  initialTab?: 'share' | 'join';
  onClose: () => void;
  onOpenWorkspaceSettings?: (workspaceId: string) => void;
  onJoinedNewWorkspace?: (workspaceId: string, name: string) => void;
  onLeftSharedWorkspace?: (workspaceId: string) => void;
}

type ModalTab = 'share' | 'join';

export const CanvasShareModal = ({
  open,
  workspaceId,
  workspaceName,
  initialTab = 'share',
  onClose,
  onOpenWorkspaceSettings,
  onJoinedNewWorkspace,
  onLeftSharedWorkspace,
}: Props) => {
  const { language } = useI18n();
  const copy = canvasShareCopy(language);
  const shareCopy = remoteShareCopy(language);
  const titleId = useId();

  const [tab, setTab] = useState<ModalTab>(initialTab);
  const [loading, setLoading] = useState(false);
  const [config, setConfig] = useState<RemoteVpsWorkspaceConfigDto | null>(null);
  const [liveStatus, setLiveStatus] = useState<RemoteVpsStatusResult | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [sshHosts, setSshHosts] = useState<string[]>([]);
  const [quickHostingHost, setQuickHostingHost] = useState<string | null>(null);
  const [quickHostError, setQuickHostError] = useState<string | null>(null);

  // One-step Join Shared Canvas form state.
  const [inviteCode, setInviteCode] = useState('');
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTab(initialTab);
    setJoinError(null);
    setQuickHostError(null);
    const api = window.canvasWorkspace?.remoteVps;
    if (!api || !workspaceId) {
      setConfig(null);
      setLiveStatus(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void api.getConfig(workspaceId).then(async (res) => {
      if (cancelled) return;
      const cfg = res.ok ? res.config : null;
      setConfig(cfg);
      setLoading(false);
      if (cfg) {
        const status = await api.getStatus(workspaceId);
        if (!cancelled) setLiveStatus(status);
      } else {
        setLiveStatus(null);
        const hostsRes = await api.listSshHosts().catch(() => ({ ok: false, hosts: [] as string[] }));
        if (!cancelled && hostsRes.ok) setSshHosts(hostsRes.hosts);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [open, workspaceId, initialTab]);

  // Auto-detect a pulse-share invite code already on the clipboard when opening Join tab.
  useEffect(() => {
    if (!open || tab !== 'join' || inviteCode.trim()) return;
    let cancelled = false;
    void navigator.clipboard
      ?.readText?.()
      .then((text) => {
        if (!cancelled && /pulse-share:\/\/v1\/[A-Za-z0-9_-]+/.test(text)) {
          setInviteCode(text.trim());
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open, tab, inviteCode]);

  const handleQuickHost = async (host: string) => {
    const api = window.canvasWorkspace?.remoteVps;
    if (!api) return;
    setQuickHostingHost(host);
    setQuickHostError(null);
    try {
      const draft: RemoteVpsWorkspaceConfigDto = {
        kind: 'vps',
        sshHost: host,
        remotePort: 4770,
        autoBootstrap: true,
        remoteWorkspaceId: workspaceId,
        storage: 'vps',
        runtime: 'vps',
        allowCapabilityRelay: true,
      };
      const testRes = await api.testAndBootstrap(workspaceId, draft);
      if (!testRes.ok) {
        setQuickHostError(testRes.error || 'Failed to connect to VPS');
        return;
      }
      const resolved: RemoteVpsWorkspaceConfigDto = { ...draft, token: testRes.token };
      const mig = await api.migrateLocal(workspaceId, resolved, { onlyIfRemoteEmpty: true });
      if (!mig.ok) {
        await api.saveConfig(workspaceId, resolved);
      }
      setConfig(resolved);
      const status = await api.getStatus(workspaceId);
      setLiveStatus(status);
    } finally {
      setQuickHostingHost(null);
    }
  };

  const handleJoinOneStep = async () => {
    const api = window.canvasWorkspace?.remoteVps;
    if (!api || !inviteCode.trim()) return;
    setJoining(true);
    setJoinError(null);
    try {
      const targetId = `ws-${Date.now()}`;
      const res = await api.joinShare(targetId, inviteCode.trim());
      if (!res.ok || !res.config) {
        setJoinError(res.error || shareCopy.joinFailed);
        return;
      }
      const displayName = res.workspaceName || copy.joinFallbackName;
      setInviteCode('');
      onJoinedNewWorkspace?.(targetId, displayName);
      onClose();
    } finally {
      setJoining(false);
    }
  };

  const handleLeaveShared = async () => {
    const api = window.canvasWorkspace?.remoteVps;
    if (!api) return;
    setLeaving(true);
    try {
      const res = await api.removeConfig(workspaceId);
      if (res.ok) {
        setConfig(null);
        setLiveStatus(null);
        onLeftSharedWorkspace?.(workspaceId);
        onClose();
      }
    } finally {
      setLeaving(false);
    }
  };

  const hostSummary = config?.sshHost || config?.endpoint || '';

  const invitePreview = (() => {
    const match = /pulse-share:\/\/v1\/([A-Za-z0-9_-]+)/.exec(inviteCode);
    if (!match) return null;
    try {
      const base64 = match[1].replace(/-/g, '+').replace(/_/g, '/');
      const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
      const binary = atob(padded);
      const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
      const decoded = JSON.parse(new TextDecoder().decode(bytes)) as {
        endpoint?: string;
        role?: string;
        name?: string;
      };
      if (!decoded.endpoint) return null;
      return {
        name: decoded.name?.trim() || copy.joinFallbackName,
        role: decoded.role || 'viewer',
        endpoint: decoded.endpoint,
      };
    } catch {
      return null;
    }
  })();

  return (
    <Modal open={open} onClose={onClose} width={540} labelledBy={titleId} className="canvas-share-modal">
      <div className="canvas-share-modal__header">
        <div className="canvas-share-modal__heading">
          <span className="canvas-share-modal__eyebrow">{copy.eyebrow}</span>
          <h2 id={titleId} className="canvas-share-modal__title">
            {workspaceName ? `${copy.title} · ${workspaceName}` : copy.title}
          </h2>
        </div>
        <Button variant="icon" size="sm" aria-label={copy.close} onClick={onClose}>
          <CloseIcon size={14} />
        </Button>
      </div>

      <div className="canvas-share-modal__body">
        <SegmentedControl
          value={tab}
          onChange={(id) => setTab(id as ModalTab)}
          options={[
            { id: 'share', label: copy.tabShare },
            { id: 'join', label: copy.tabJoin },
          ]}
        />

        {tab === 'share' && (
          <>
            {loading ? (
              <div className="canvas-share-modal__loading">{copy.loadingStatus}</div>
            ) : !config ? (
              <div className="canvas-share-modal__local-card">
                <div className="canvas-share-modal__local-title">{copy.localOnlyTitle}</div>
                <p className="canvas-share-modal__local-body">{copy.localOnlyBody}</p>
                {sshHosts.length > 0 && (
                  <div className="remote-vps-host-chips">
                    {sshHosts.slice(0, 6).map((host) => (
                      <Button
                        key={host}
                        variant="primary"
                        size="sm"
                        disabled={quickHostingHost !== null}
                        onClick={() => void handleQuickHost(host)}
                      >
                        {quickHostingHost === host
                          ? language === 'zh'
                            ? `托管到 ${host}…`
                            : `Hosting on ${host}…`
                          : language === 'zh'
                            ? `一键托管到 ${host}`
                            : `Host on ${host}`}
                      </Button>
                    ))}
                  </div>
                )}
                {quickHostError && <div className="remote-vps-status is-error">{quickHostError}</div>}
                <div className="remote-vps-actions">
                  <Button
                    variant={sshHosts.length > 0 ? 'secondary' : 'primary'}
                    disabled={quickHostingHost !== null}
                    onClick={() => {
                      onClose();
                      onOpenWorkspaceSettings?.(workspaceId);
                    }}
                  >
                    {copy.setupRemoteHosting}
                  </Button>
                </div>
              </div>
            ) : config.shareRole ? (
              <div className="canvas-share-modal__local-card">
                <div className="canvas-share-modal__local-title">
                  {copy.guestRoleTitle(config.shareRole)}
                </div>
                <p className="canvas-share-modal__local-body">
                  {config.shareRole === 'viewer'
                    ? shareCopy.viewerReadOnlyNotice
                    : copy.hostedOn(hostSummary)}
                </p>
                <div className="remote-vps-actions">
                  <Button
                    variant="secondary"
                    disabled={leaving}
                    onClick={() => void handleLeaveShared()}
                  >
                    {leaving ? copy.leaving : copy.leaveShared}
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <div className="canvas-share-modal__host-bar">
                  <div className="canvas-share-modal__host-left">
                    <span
                      className={`canvas-share-modal__dot${liveStatus && !liveStatus.connected ? ' is-offline' : ''}`}
                      aria-hidden="true"
                    />
                    <span>
                      {copy.hostedOn(hostSummary)}
                      {liveStatus?.connected &&
                        typeof liveStatus.onlineClients === 'number' &&
                        liveStatus.onlineClients > 0 &&
                        ` · ${copy.onlineCount(liveStatus.onlineClients)}`}
                    </span>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      onClose();
                      onOpenWorkspaceSettings?.(workspaceId);
                    }}
                  >
                    {copy.setupRemoteHosting}
                  </Button>
                </div>
                <RemoteVpsSharePanel
                  workspaceId={workspaceId}
                  workspaceName={workspaceName}
                  defaultEndpoint={config.endpoint}
                  detectedTailscaleUrl={liveStatus?.tailscaleUrl}
                />
              </>
            )}
          </>
        )}

        {tab === 'join' && (
          <div className="canvas-share-modal__join-form">
            <FieldRow label={shareCopy.inviteCodeLabel} hint={copy.joinOneStepHint}>
              <TextField
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                placeholder={shareCopy.inviteCodePlaceholder}
              />
            </FieldRow>
            {invitePreview && (
              <div className="remote-vps-status is-ok">
                {copy.invitePreviewSummary(
                  invitePreview.name,
                  invitePreview.role,
                  invitePreview.endpoint,
                )}
              </div>
            )}
            {joinError && <div className="remote-vps-status is-error">{joinError}</div>}
            <div className="remote-vps-actions">
              <Button
                variant="primary"
                disabled={!inviteCode.trim() || joining}
                onClick={() => void handleJoinOneStep()}
              >
                {joining ? shareCopy.joining : copy.joinAndOpen}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};
