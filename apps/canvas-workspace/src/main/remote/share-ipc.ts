import { ipcMain } from 'electron';
import type {
  RemoteVpsShareSummary,
  RemoteVpsWorkspaceConfigDto,
} from '../../shared/api/remote-vps';

export function setupRemoteVpsShareIpc(): void {
  ipcMain.handle('remote-vps:listShares', async (_event, payload: { workspaceId: string }) => {
    try {
      const { resolveRemoteWorkspaceTarget } = await import('./client');
      const target = await resolveRemoteWorkspaceTarget(payload.workspaceId, 'any');
      if (!target) return { ok: false, error: 'Workspace is not bound to a VPS.' };
      const qs = `?workspaceId=${encodeURIComponent(target.remoteWorkspaceId)}`;
      const res = await fetch(`${target.endpoint}/v1/shares${qs}`, {
        headers: { Authorization: `Bearer ${target.token}` },
        signal: AbortSignal.timeout(10_000),
      });
      const body = (await res.json()) as {
        ok?: boolean;
        shares?: RemoteVpsShareSummary[];
        error?: string;
        message?: string;
      };
      if (!res.ok || !body.ok) {
        return { ok: false, error: body.error || body.message || `HTTP ${res.status}` };
      }
      return { ok: true, shares: body.shares ?? [] };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(
    'remote-vps:createShare',
    async (
      _event,
      payload: {
        workspaceId: string;
        role: 'viewer' | 'editor' | 'collaborator';
        label?: string;
        expiresInHours?: number;
        publicEndpoint?: string;
        workspaceName?: string;
      },
    ) => {
      try {
        const { getRemoteWorkspaceConfig } = await import('./config');
        const { resolveRemoteWorkspaceTarget } = await import('./client');
        const cfg = getRemoteWorkspaceConfig(payload.workspaceId);
        const target = await resolveRemoteWorkspaceTarget(payload.workspaceId, 'any');
        if (!target) return { ok: false, error: 'Workspace is not bound to a VPS.' };

        let shareEndpoint = (payload.publicEndpoint?.trim() || '').replace(/\/+$/, '');
        if (!shareEndpoint) {
          if (cfg?.sshHost) {
            const metaRes = await fetch(`${target.endpoint}/v1/meta`, {
              headers: { Authorization: `Bearer ${target.token}` },
              signal: AbortSignal.timeout(4_000),
            }).catch(() => null);
            const metaBody = metaRes
              ? ((await metaRes.json().catch(() => ({}))) as { tailscaleUrl?: string })
              : {};
            if (metaBody.tailscaleUrl) {
              shareEndpoint = metaBody.tailscaleUrl.replace(/\/+$/, '');
            }
          } else {
            shareEndpoint = target.endpoint;
          }
        }

        if (
          !shareEndpoint ||
          (cfg?.sshHost &&
            /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?(?:\/|$)/i.test(shareEndpoint))
        ) {
          return {
            ok: false,
            error: 'LOOPBACK_SHARE_ENDPOINT',
          };
        }

        const res = await fetch(`${target.endpoint}/v1/shares`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${target.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            workspaceId: target.remoteWorkspaceId,
            role: payload.role,
            label: payload.label,
            expiresInHours: payload.expiresInHours,
          }),
          signal: AbortSignal.timeout(10_000),
        });
        const body = (await res.json()) as {
          ok?: boolean;
          share?: RemoteVpsShareSummary & { token: string };
          error?: string;
          message?: string;
        };
        if (!res.ok || !body.ok || !body.share) {
          return { ok: false, error: body.error || body.message || `HTTP ${res.status}` };
        }
        const invitePayload = {
          v: 1,
          endpoint: shareEndpoint,
          workspaceId: target.remoteWorkspaceId,
          token: body.share.token,
          role: payload.role,
          ...(payload.workspaceName?.trim() ? { name: payload.workspaceName.trim() } : {}),
        };
        const inviteCode = `pulse-share://v1/${Buffer.from(JSON.stringify(invitePayload), 'utf8').toString('base64url')}`;
        return { ok: true, inviteCode, share: body.share };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  );

  ipcMain.handle(
    'remote-vps:revokeShare',
    async (_event, payload: { workspaceId: string; shareId: string }) => {
      try {
        const { resolveRemoteWorkspaceTarget } = await import('./client');
        const target = await resolveRemoteWorkspaceTarget(payload.workspaceId, 'any');
        if (!target) return { ok: false, error: 'Workspace is not bound to a VPS.' };
        const res = await fetch(`${target.endpoint}/v1/shares/${encodeURIComponent(payload.shareId)}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${target.token}` },
          signal: AbortSignal.timeout(10_000),
        });
        const body = (await res.json()) as { ok?: boolean; revoked?: boolean; error?: string; message?: string };
        if (!res.ok || !body.ok) {
          return { ok: false, error: body.error || body.message || `HTTP ${res.status}` };
        }
        return { ok: true, revoked: body.revoked ?? true };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  );

  ipcMain.handle(
    'remote-vps:joinShare',
    async (_event, payload: { workspaceId: string; inviteCode: string }) => {
      try {
        const match = /pulse-share:\/\/v1\/([A-Za-z0-9_-]+)/.exec(payload.inviteCode);
        if (!match) {
          return { ok: false, error: 'Invalid invite code format (expected pulse-share://v1/...).' };
        }
        const decoded = JSON.parse(
          Buffer.from(match[1], 'base64url').toString('utf8'),
        ) as {
          endpoint?: string;
          workspaceId?: string;
          token?: string;
          role?: 'viewer' | 'editor' | 'collaborator';
          name?: string;
        };
        if (!decoded.endpoint || !decoded.workspaceId || !decoded.token) {
          return { ok: false, error: 'Invite code is missing endpoint, workspaceId, or token.' };
        }
        const endpoint = decoded.endpoint.replace(/\/+$/, '');
        let res: Response;
        try {
          res = await fetch(`${endpoint}/v1/meta`, {
            headers: { Authorization: `Bearer ${decoded.token}` },
            signal: AbortSignal.timeout(10_000),
          });
        } catch (netError) {
          const raw = netError instanceof Error ? netError.message : String(netError);
          return {
            ok: false,
            error: `Cannot reach ${endpoint} (${raw}). Check that Tailscale/VPN is connected and the remote VPS daemon is running.`,
          };
        }
        const meta = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          role?: 'viewer' | 'editor' | 'collaborator' | 'admin';
          workspaceId?: string;
          message?: string;
        };
        if (!res.ok || !meta.ok) {
          return { ok: false, error: meta.message || `Failed to verify invite (HTTP ${res.status})` };
        }
        const grantedRole =
          meta.role === 'viewer' || meta.role === 'editor' || meta.role === 'collaborator'
            ? meta.role
            : decoded.role ?? 'viewer';
        const config: RemoteVpsWorkspaceConfigDto = {
          kind: 'vps',
          endpoint,
          token: decoded.token,
          remoteWorkspaceId: meta.workspaceId || decoded.workspaceId,
          storage: 'vps',
          runtime: grantedRole === 'collaborator' ? 'vps' : 'local',
          autoBootstrap: false,
          shareRole: grantedRole,
        };
        const { saveRemoteWorkspaceConfig } = await import('./config');
        saveRemoteWorkspaceConfig(payload.workspaceId, config);
        return {
          ok: true,
          config,
          role: grantedRole,
          ...(decoded.name?.trim() ? { workspaceName: decoded.name.trim() } : {}),
        };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  );
}
