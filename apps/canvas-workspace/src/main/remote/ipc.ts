import { ipcMain } from 'electron';
import type {
  RemoteVpsMigrateResult,
  RemoteVpsTestResult,
  RemoteVpsWorkspaceConfigDto,
} from '../../shared/api/remote-vps';

export interface RemoteVpsIpcDeps {
  getLocalStorage: () => Promise<import('@pulse-coder/storage').PulseStorage | null>;
  getLocalWorkspaceDir: (workspaceId: string) => string;
}

let registered = false;

export function setupRemoteVpsIpc(deps: RemoteVpsIpcDeps): void {
  if (registered) return;
  registered = true;

  ipcMain.handle('remote-vps:listSshHosts', async () => {
    const { parseSshConfigHosts } = await import('./ssh-bootstrap');
    return { ok: true, hosts: parseSshConfigHosts() };
  });

  ipcMain.handle('remote-vps:getConfig', async (_event, payload: { workspaceId: string }) => {
    const { getRemoteWorkspaceConfig } = await import('./config');
    return { ok: true, config: getRemoteWorkspaceConfig(payload.workspaceId) };
  });

  ipcMain.handle(
    'remote-vps:saveConfig',
    async (_event, payload: { workspaceId: string; config: RemoteVpsWorkspaceConfigDto }) => {
      try {
        const { saveRemoteWorkspaceConfig } = await import('./config');
        saveRemoteWorkspaceConfig(payload.workspaceId, payload.config);
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  );

  ipcMain.handle('remote-vps:removeConfig', async (_event, payload: { workspaceId: string }) => {
    try {
      const { removeRemoteWorkspaceConfig } = await import('./config');
      const removed = removeRemoteWorkspaceConfig(payload.workspaceId);
      return { ok: true, removed };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(
    'remote-vps:testAndBootstrap',
    async (
      _event,
      payload: { workspaceId: string; config: RemoteVpsWorkspaceConfigDto },
    ): Promise<RemoteVpsTestResult> => {
      try {
        const config = { ...payload.config };
        let bootMeta: { uploaded?: boolean; installedDeps?: boolean; restarted?: boolean } = {};

        if (!config.endpoint && config.sshHost && config.autoBootstrap !== false) {
          const { bootstrapRemoteVpsDaemon } = await import('./ssh-bootstrap');
          const boot = await bootstrapRemoteVpsDaemon({
            sshHost: config.sshHost,
            sshPort: config.sshPort,
            remotePort: config.remotePort,
            workDir: config.cwd,
          });
          config.token = config.token || boot.token;
          bootMeta = {
            uploaded: boot.uploaded,
            installedDeps: boot.installedDeps,
            restarted: boot.restarted,
          };
        }

        const { resolveRemoteTargetFromConfig } = await import('./client');
        const target = await resolveRemoteTargetFromConfig(payload.workspaceId, config);
        const res = await fetch(`${target.endpoint}/v1/meta`, {
          headers: { Authorization: `Bearer ${target.token}` },
          signal: AbortSignal.timeout(10_000),
        });
        const body = (await res.json()) as {
          ok?: boolean;
          version?: string;
          generation?: string;
          message?: string;
        };
        if (!res.ok || !body.ok) {
          return { ok: false, error: body.message || `Remote daemon returned HTTP ${res.status}` };
        }
        return {
          ok: true,
          version: body.version,
          generation: body.generation,
          token: target.token,
          ...bootMeta,
        };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  );

  ipcMain.handle(
    'remote-vps:migrateLocal',
    async (
      _event,
      payload: { workspaceId: string; config: RemoteVpsWorkspaceConfigDto },
    ): Promise<RemoteVpsMigrateResult> => {
      try {
        const localStorage = await deps.getLocalStorage();
        if (!localStorage) {
          return { ok: false, error: 'Local SQLite storage is not active.' };
        }
        const { migrateLocalWorkspaceToVps } = await import('./migrate');
        const res = await migrateLocalWorkspaceToVps({
          workspaceId: payload.workspaceId,
          config: payload.config,
          localStorage,
          localWorkspaceDir: deps.getLocalWorkspaceDir(payload.workspaceId),
        });
        return { ok: true, ...res };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  );

  ipcMain.handle(
    'remote-vps:readWorkspaceDoc',
    async (_event, payload: { workspaceId: string; cwd?: string }) => {
      try {
        const { resolveRemoteWorkspaceTarget } = await import('./client');
        const target = await resolveRemoteWorkspaceTarget(payload.workspaceId, 'any');
        if (!target) return { ok: false, error: 'Workspace is not bound to a VPS.' };
        const dir = payload.cwd?.trim() || target.cwd || '';
        const qs = dir ? `?cwd=${encodeURIComponent(dir)}` : '';
        const res = await fetch(`${target.endpoint}/v1/workspace-doc${qs}`, {
          headers: { Authorization: `Bearer ${target.token}` },
          signal: AbortSignal.timeout(10_000),
        });
        const body = (await res.json()) as {
          ok?: boolean;
          exists?: boolean;
          content?: string | null;
          path?: string;
          error?: string;
        };
        if (!res.ok || !body.ok) {
          return { ok: false, error: body.error || `HTTP ${res.status}` };
        }
        return { ok: true, exists: body.exists, content: body.content ?? null, path: body.path };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  );

  ipcMain.handle(
    'remote-vps:writeWorkspaceDoc',
    async (_event, payload: { workspaceId: string; content: string; cwd?: string }) => {
      try {
        const { resolveRemoteWorkspaceTarget } = await import('./client');
        const target = await resolveRemoteWorkspaceTarget(payload.workspaceId, 'any');
        if (!target) return { ok: false, error: 'Workspace is not bound to a VPS.' };
        const res = await fetch(`${target.endpoint}/v1/workspace-doc`, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${target.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            cwd: payload.cwd?.trim() || target.cwd,
            content: payload.content,
          }),
          signal: AbortSignal.timeout(10_000),
        });
        const body = (await res.json()) as { ok?: boolean; path?: string; error?: string };
        if (!res.ok || !body.ok) {
          return { ok: false, error: body.error || `HTTP ${res.status}` };
        }
        return { ok: true, path: body.path };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  );

  ipcMain.handle(
    'remote-vps:listDirs',
    async (
      _event,
      payload: {
        workspaceId: string;
        dirPath?: string;
        showHidden?: boolean;
        config?: RemoteVpsWorkspaceConfigDto;
      },
    ) => {
      try {
        const { resolveRemoteTargetFromConfig, resolveRemoteWorkspaceTarget } = await import(
          './client'
        );
        const target = payload.config
          ? await resolveRemoteTargetFromConfig(payload.workspaceId, payload.config)
          : await resolveRemoteWorkspaceTarget(payload.workspaceId, 'any');
        if (!target) return { ok: false, error: 'Workspace is not bound to a VPS.' };
        const params = new URLSearchParams();
        const dir = payload.dirPath?.trim() || target.cwd || '';
        if (dir) params.set('path', dir);
        if (payload.showHidden) params.set('showHidden', '1');
        const qs = params.toString() ? `?${params.toString()}` : '';
        const res = await fetch(`${target.endpoint}/v1/fs/list-dirs${qs}`, {
          headers: { Authorization: `Bearer ${target.token}` },
          signal: AbortSignal.timeout(10_000),
        });
        const body = (await res.json()) as {
          ok?: boolean;
          path?: string;
          parent?: string | null;
          home?: string;
          entries?: Array<{ name: string; path: string; hidden: boolean }>;
          error?: string;
          message?: string;
        };
        if (!res.ok || !body.ok) {
          return {
            ok: false,
            error: body.error || body.message || `HTTP ${res.status}`,
          };
        }
        return {
          ok: true,
          path: body.path,
          parent: body.parent ?? null,
          home: body.home,
          entries: body.entries ?? [],
        };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  );

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
        shares?: import('../../shared/api/remote-vps').RemoteVpsShareSummary[];
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
      },
    ) => {
      try {
        const { resolveRemoteWorkspaceTarget } = await import('./client');
        const target = await resolveRemoteWorkspaceTarget(payload.workspaceId, 'any');
        if (!target) return { ok: false, error: 'Workspace is not bound to a VPS.' };
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
          share?: import('../../shared/api/remote-vps').RemoteVpsShareSummary & { token: string };
          error?: string;
          message?: string;
        };
        if (!res.ok || !body.ok || !body.share) {
          return { ok: false, error: body.error || body.message || `HTTP ${res.status}` };
        }
        const shareEndpoint = (payload.publicEndpoint?.trim() || target.endpoint).replace(/\/+$/, '');
        const invitePayload = {
          v: 1,
          endpoint: shareEndpoint,
          workspaceId: target.remoteWorkspaceId,
          token: body.share.token,
          role: payload.role,
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
        const raw = payload.inviteCode.trim();
        const prefix = 'pulse-share://v1/';
        if (!raw.startsWith(prefix)) {
          return { ok: false, error: 'Invalid invite code format (expected pulse-share://v1/...).' };
        }
        const decoded = JSON.parse(
          Buffer.from(raw.slice(prefix.length), 'base64url').toString('utf8'),
        ) as {
          endpoint?: string;
          workspaceId?: string;
          token?: string;
          role?: 'viewer' | 'editor' | 'collaborator';
        };
        if (!decoded.endpoint || !decoded.workspaceId || !decoded.token) {
          return { ok: false, error: 'Invite code is missing endpoint, workspaceId, or token.' };
        }
        const endpoint = decoded.endpoint.replace(/\/+$/, '');
        const res = await fetch(`${endpoint}/v1/meta`, {
          headers: { Authorization: `Bearer ${decoded.token}` },
          signal: AbortSignal.timeout(10_000),
        });
        const meta = (await res.json()) as {
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
        return { ok: true, config, role: grantedRole };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  );
}
