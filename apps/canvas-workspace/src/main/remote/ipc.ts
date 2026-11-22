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
}
