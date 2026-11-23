import { useCallback, useEffect, useState } from 'react';
import type {
  RemoteVpsShareRole,
  RemoteVpsShareSummary,
} from '../../../../../../shared/api/remote-vps';
import { Button, FieldRow, SegmentedControl, TextField } from '../../../../components/ui';
import { useI18n } from '../../../../i18n';
import { remoteShareCopy } from '../../components/RemoteFolderPickerModal/copy';

interface Props {
  workspaceId: string;
  defaultEndpoint?: string;
}

type ExpiryKey = '24h' | '7d' | 'never';

export const RemoteVpsSharePanel = ({ workspaceId, defaultEndpoint }: Props) => {
  const { language } = useI18n();
  const copy = remoteShareCopy(language);

  const [role, setRole] = useState<RemoteVpsShareRole>('editor');
  const [expiry, setExpiry] = useState<ExpiryKey>('7d');
  const [publicEndpoint, setPublicEndpoint] = useState(defaultEndpoint ?? '');
  const [shares, setShares] = useState<RemoteVpsShareSummary[]>([]);
  const [latestInvite, setLatestInvite] = useState<string | null>(null);
  const [busy, setBusy] = useState<'create' | string | null>(null);
  const [statusMsg, setStatusMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const loadShares = useCallback(async () => {
    const api = window.canvasWorkspace?.remoteVps;
    if (!api) return;
    const res = await api.listShares(workspaceId);
    if (!res.ok) {
      const raw = res.error || '';
      setStatusMsg({
        kind: 'err',
        text: raw.includes('Route not found') ? copy.oldDaemonShareError : raw,
      });
      return;
    }
    setShares(res.shares ?? []);
  }, [workspaceId, copy.oldDaemonShareError]);

  useEffect(() => {
    void loadShares();
  }, [loadShares]);

  const handleCreate = async () => {
    const api = window.canvasWorkspace?.remoteVps;
    if (!api) return;
    setBusy('create');
    setStatusMsg(null);
    try {
      const expiresInHours = expiry === '24h' ? 24 : expiry === '7d' ? 24 * 7 : undefined;
      const res = await api.createShare(workspaceId, {
        role,
        expiresInHours,
        publicEndpoint: publicEndpoint.trim() || undefined,
      });
      if (!res.ok || !res.inviteCode) {
        const raw = res.error || 'Failed to create share';
        setStatusMsg({
          kind: 'err',
          text: raw.includes('Route not found') ? copy.oldDaemonShareError : raw,
        });
        return;
      }
      setLatestInvite(res.inviteCode);
      try {
        await navigator.clipboard.writeText(res.inviteCode);
      } catch {
        // Clipboard may be unavailable in headless contexts; invite box still renders below.
      }
      setStatusMsg({ kind: 'ok', text: copy.copiedOk });
      await loadShares();
    } finally {
      setBusy(null);
    }
  };

  const handleRevoke = async (shareId: string) => {
    const api = window.canvasWorkspace?.remoteVps;
    if (!api) return;
    setBusy(shareId);
    setStatusMsg(null);
    try {
      const res = await api.revokeShare(workspaceId, shareId);
      if (!res.ok) {
        setStatusMsg({ kind: 'err', text: res.error || 'Failed to revoke share' });
        return;
      }
      await loadShares();
    } finally {
      setBusy(null);
    }
  };

  const roleHint =
    role === 'viewer'
      ? copy.roleHintViewer
      : role === 'editor'
        ? copy.roleHintEditor
        : copy.roleHintCollaborator;

  return (
    <div className="remote-vps-body">
      <FieldRow label={copy.roleLabel} hint={roleHint}>
        <SegmentedControl
          value={role}
          onChange={(id) => setRole(id as RemoteVpsShareRole)}
          options={[
            { id: 'viewer', label: copy.roleViewer },
            { id: 'editor', label: copy.roleEditor },
            { id: 'collaborator', label: copy.roleCollaborator },
          ]}
        />
      </FieldRow>

      <FieldRow label={copy.endpointLabel} hint={copy.endpointHint}>
        <TextField
          value={publicEndpoint}
          onChange={(e) => setPublicEndpoint(e.target.value)}
          placeholder={copy.endpointPlaceholder}
        />
      </FieldRow>

      <FieldRow label={copy.expiryLabel}>
        <SegmentedControl
          value={expiry}
          onChange={(id) => setExpiry(id as ExpiryKey)}
          options={[
            { id: '24h', label: copy.expiry24h },
            { id: '7d', label: copy.expiry7d },
            { id: 'never', label: copy.expiryNever },
          ]}
        />
      </FieldRow>

      <div className="remote-vps-actions">
        <Button variant="secondary" disabled={busy !== null} onClick={() => void handleCreate()}>
          {busy === 'create' ? copy.creating : copy.createAction}
        </Button>
      </div>

      {latestInvite && (
        <div className="remote-vps-invite-box">
          <TextField value={latestInvite} readOnly className="remote-vps-invite-input" />
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              void navigator.clipboard.writeText(latestInvite).catch(() => undefined);
            }}
          >
            {copy.copyAgain}
          </Button>
        </div>
      )}

      {statusMsg && (
        <div className={`remote-vps-status ${statusMsg.kind === 'err' ? 'is-error' : 'is-ok'}`}>
          {statusMsg.text}
        </div>
      )}

      <div className="remote-vps-share-list">
        <div className="remote-vps-share-list-title">{copy.activeShares}</div>
        {shares.length === 0 ? (
          <div className="remote-vps-share-empty">{copy.noShares}</div>
        ) : (
          shares.map((item) => (
            <div key={item.id} className="remote-vps-share-row">
              <div className="remote-vps-share-meta">
                <span className="remote-vps-badge">{item.role}</span>
                <span className="remote-vps-host">{item.tokenPreview}</span>
              </div>
              <Button
                variant="secondary"
                size="sm"
                disabled={busy !== null}
                onClick={() => void handleRevoke(item.id)}
              >
                {busy === item.id ? copy.revoking : copy.revoke}
              </Button>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
