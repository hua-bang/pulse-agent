import { useEffect, useId, useState, type RefObject } from 'react';
import type {
  RemoteVpsStatusResult,
  RemoteVpsWorkspaceConfigDto,
} from '../../../../../../shared/api/remote-vps';
import { CloseIcon, ExportIcon } from '../../../../components/icons';
import { Button, FieldRow, Modal, Popover, TextField } from '../../../../components/ui';
import { useI18n } from '../../../../i18n';
import { RemoteVpsSharePanel } from '../../internal/WorkspaceSettings/RemoteVpsSharePanel';
import { canvasShareCopy, remoteShareCopy } from '../RemoteFolderPickerModal/copy';
import './index.css';

interface JoinSharedCanvasModalProps {
  open: boolean;
  onClose: () => void;
  onJoinedNewWorkspace?: (workspaceId: string, name: string) => void;
}

/**
 * Dedicated one-step dialog for joining a teammate's shared canvas via invite code.
 * Accessible from Sidebar "+", WorkspaceTabs "+", and Launcher without requiring an open canvas.
 */
export const JoinSharedCanvasModal = ({
  open,
  onClose,
  onJoinedNewWorkspace,
}: JoinSharedCanvasModalProps) => {
  const { language } = useI18n();
  const copy = canvasShareCopy(language);
  const shareCopy = remoteShareCopy(language);
  const titleId = useId();

  const [inviteCode, setInviteCode] = useState('');
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setJoinError(null);
    if (inviteCode.trim()) return;
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
  }, [open, inviteCode]);

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
    <Modal open={open} onClose={onClose} width={460} labelledBy={titleId} className="canvas-share-modal">
      <div className="canvas-share-modal__header">
        <div className="canvas-share-modal__heading">
          <span className="canvas-share-modal__eyebrow">{copy.eyebrow}</span>
          <h2 id={titleId} className="canvas-share-modal__title">
            {copy.joinTitle}
          </h2>
        </div>
        <Button variant="icon" size="sm" aria-label={copy.close} onClick={onClose}>
          <CloseIcon size={14} />
        </Button>
      </div>

      <div className="canvas-share-modal__body">
        <div className="canvas-share-modal__join-form">
          <FieldRow label={shareCopy.inviteCodeLabel} hint={copy.joinOneStepHint}>
            <TextField
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              placeholder={shareCopy.inviteCodePlaceholder}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && inviteCode.trim() && !joining) {
                  void handleJoinOneStep();
                }
              }}
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
      </div>
    </Modal>
  );
};

interface CanvasShareProps {
  open: boolean;
  anchorRef?: RefObject<HTMLElement>;
  workspaceId: string;
  workspaceName: string;
  onClose: () => void;
  onOpenWorkspaceSettings?: (workspaceId: string) => void;
  onExportWorkspace?: (workspaceId: string) => void;
  onLeftSharedWorkspace?: (workspaceId: string) => void;
}

/**
 * Focused share flyout anchored to the top-bar Share button (falls back to Modal if no anchorRef).
 * Owns only the active canvas's live hosting, invite generation, and offline `.zip` export.
 */
export const CanvasShareModal = ({
  open,
  anchorRef,
  workspaceId,
  workspaceName,
  onClose,
  onOpenWorkspaceSettings,
  onExportWorkspace,
  onLeftSharedWorkspace,
}: CanvasShareProps) => {
  const { language } = useI18n();
  const copy = canvasShareCopy(language);
  const shareCopy = remoteShareCopy(language);
  const titleId = useId();

  const [loading, setLoading] = useState(false);
  const [config, setConfig] = useState<RemoteVpsWorkspaceConfigDto | null>(null);
  const [liveStatus, setLiveStatus] = useState<RemoteVpsStatusResult | null>(null);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (!open) return;
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
      }
    });
    return () => {
      cancelled = true;
    };
  }, [open, workspaceId]);

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

  if (!open) return null;

  const hostSummary = config?.sshHost || config?.endpoint || '';

  const content = (
    <>
      <div className="canvas-share-modal__header">
        <div className="canvas-share-modal__heading">
          <h2 id={titleId} className="canvas-share-modal__title">
            {workspaceName ? `${copy.title} · ${workspaceName}` : copy.title}
          </h2>
        </div>
        <Button variant="icon" size="sm" aria-label={copy.close} onClick={onClose}>
          <CloseIcon size={14} />
        </Button>
      </div>

      <div className="canvas-share-modal__body">
        {loading ? (
          <div className="canvas-share-modal__loading">{copy.loadingStatus}</div>
        ) : !config ? (
          <div className="canvas-share-modal__local-card">
            <div className="canvas-share-modal__local-title">{copy.localOnlyTitle}</div>
            <p className="canvas-share-modal__local-body">{copy.localOnlyBody}</p>
            <div className="remote-vps-actions">
              <Button
                variant="primary"
                size="sm"
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
              {config.shareLabel ? ` · ${config.shareLabel}` : ''}
            </div>
            <p className="canvas-share-modal__local-body">
              {config.shareRole === 'viewer'
                ? shareCopy.viewerReadOnlyNotice
                : copy.hostedOn(hostSummary)}
            </p>
            <div className="remote-vps-actions">
              <Button
                variant="secondary"
                size="sm"
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
                <span className="canvas-share-modal__host-text">
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
                {copy.connectionSettings}
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

        {onExportWorkspace && (
          <div className="canvas-share-modal__footer">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                onClose();
                onExportWorkspace(workspaceId);
              }}
            >
              <ExportIcon size={13} />
              <span>{copy.exportOfflineZip}</span>
            </Button>
          </div>
        )}
      </div>
    </>
  );

  if (anchorRef) {
    return (
      <Popover
        anchorRef={anchorRef}
        placement="bottom"
        align="end"
        gap={6}
        autoFocus={false}
        keyboardNavigation={false}
        ariaLabel={copy.title}
        className="canvas-share-popover"
        onClose={onClose}
      >
        {content}
      </Popover>
    );
  }

  return (
    <Modal open={open} onClose={onClose} width={440} labelledBy={titleId} className="canvas-share-modal">
      {content}
    </Modal>
  );
};
