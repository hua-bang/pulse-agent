import { ipcMain } from 'electron';
import type {
  RemoteVpsMigrateResult,
  RemoteVpsStatusResult,
  RemoteVpsTestResult,
  RemoteVpsWorkspaceConfigDto,
} from '../../shared/api/remote-vps';
import { setupRemoteVpsShareIpc } from './share-ipc';

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
    'remote-vps:getStatus',
    async (_event, payload: { workspaceId: string }): Promise<RemoteVpsStatusResult> => {
      try {
        const { resolveRemoteWorkspaceTarget } = await import('./client');
        const target = await resolveRemoteWorkspaceTarget(payload.workspaceId, 'any');
        if (!target) {
          return { ok: true, connected: false };
        }
        const metaQs = `?workspaceId=${encodeURIComponent(target.remoteWorkspaceId)}`;
        const res = await fetch(`${target.endpoint}/v1/meta${metaQs}`, {
          headers: { Authorization: `Bearer ${target.token}` },
          signal: AbortSignal.timeout(5_000),
        });
        const body = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          version?: string;
          bundleHash?: string;
          tailscaleUrl?: string;
          onlineClients?: number;
          role?: string;
          capabilities?: string[];
          message?: string;
        };
        if (!res.ok || !body.ok) {
          return {
            ok: false,
            connected: false,
            error: body.message || `HTTP ${res.status}`,
          };
        }
        let outdatedDaemon = false;
        try {
          const { computeBundledVpsDaemonHash } = await import('./ssh-bootstrap');
          const localHash = computeBundledVpsDaemonHash();
          if (body.bundleHash) {
            outdatedDaemon = body.bundleHash !== localHash;
          } else if (Array.isArray(body.capabilities)) {
            outdatedDaemon =
              !body.capabilities.includes('tools-exec') ||
              !body.capabilities.includes('capability-relay');
          }
        } catch {
          // Dev checkout without compiled vps-daemon bundle: skip hash check.
        }
        return {
          ok: true,
          connected: true,
          version: body.version,
          bundleHash: body.bundleHash,
          outdatedDaemon,
          tailscaleUrl: body.tailscaleUrl,
          ...(typeof body.onlineClients === 'number' ? { onlineClients: body.onlineClients } : {}),
          role: body.role,
        };
      } catch (error) {
        return {
          ok: false,
          connected: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  );

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
          bundleHash?: string;
          tailscaleUrl?: string;
          message?: string;
        };
        if (!res.ok || !body.ok) {
          return { ok: false, error: body.message || `Remote daemon returned HTTP ${res.status}` };
        }
        return {
          ok: true,
          version: body.version,
          generation: body.generation,
          bundleHash: body.bundleHash,
          tailscaleUrl: body.tailscaleUrl,
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
      payload: {
        workspaceId: string;
        config: RemoteVpsWorkspaceConfigDto;
        onlyIfRemoteEmpty?: boolean;
      },
    ): Promise<RemoteVpsMigrateResult> => {
      try {
        const localStorage = await deps.getLocalStorage();
        if (!localStorage) {
          if (payload.onlyIfRemoteEmpty) {
            const { saveRemoteWorkspaceConfig } = await import('./config');
            saveRemoteWorkspaceConfig(payload.workspaceId, payload.config);
            return { ok: true, migrated: false };
          }
          return { ok: false, error: 'Local SQLite storage is not active.' };
        }
        const { migrateLocalWorkspaceToVps } = await import('./migrate');
        const res = await migrateLocalWorkspaceToVps({
          workspaceId: payload.workspaceId,
          config: payload.config,
          localStorage,
          localWorkspaceDir: deps.getLocalWorkspaceDir(payload.workspaceId),
          onlyIfRemoteEmpty: payload.onlyIfRemoteEmpty,
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

  setupRemoteVpsShareIpc();
}
