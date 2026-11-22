import { resolveRemoteWorkspaceTarget } from './client';
import { connectRemotePty, type RemotePtyHandle } from './runtime-client';

export interface RemotePtyAdapter {
  readonly isRemote: true;
  readonly pid: number;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  detach(): void;
  getCwd(): Promise<string | null>;
  onData(listener: (data: string) => void): { dispose(): void };
  onExit(listener: (event: { exitCode: number }) => void): { dispose(): void };
}

/**
 * Try to spawn or attach a PTY on the VPS bound to `workspaceId`.
 * Returns `null` when the workspace is local.
 */
export async function trySpawnRemotePty(payload: {
  id: string;
  cols: number;
  rows: number;
  cwd?: string;
  workspaceId?: string;
  env?: Record<string, string | undefined>;
}): Promise<
  { ok: true; adapter: RemotePtyAdapter; reused: boolean } | { ok: false; error: string } | null
> {
  if (!payload.workspaceId) return null;
  const target = await resolveRemoteWorkspaceTarget(payload.workspaceId);
  if (!target) return null;

  const dataListeners = new Set<(data: string) => void>();
  const exitListeners = new Set<(event: { exitCode: number }) => void>();

  const result = await connectRemotePty(
    target,
    {
      id: payload.id,
      cols: payload.cols,
      rows: payload.rows,
      cwd: payload.cwd,
      env: payload.env,
    },
    {
      onData: (data) => {
        for (const fn of dataListeners) fn(data);
      },
      onExit: (exitCode) => {
        for (const fn of exitListeners) fn({ exitCode });
      },
    },
  );

  if (!result.ok) return result;
  const handle: RemotePtyHandle = result.handle;

  const adapter: RemotePtyAdapter = {
    isRemote: true,
    pid: handle.pid ?? 0,
    write: (data) => handle.write(data),
    resize: (cols, rows) => handle.resize(cols, rows),
    kill: () => handle.kill(),
    detach: () => handle.detach(),
    getCwd: () => handle.getCwd(),
    onData: (listener) => {
      dataListeners.add(listener);
      return {
        dispose: () => {
          dataListeners.delete(listener);
        },
      };
    },
    onExit: (listener) => {
      exitListeners.add(listener);
      return {
        dispose: () => {
          exitListeners.delete(listener);
        },
      };
    },
  };

  return { ok: true, adapter, reused: result.reused };
}
