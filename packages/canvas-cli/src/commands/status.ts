import { Command } from 'commander';
import { DEFAULT_STORE_DIR } from '../core/constants';
import { listWorkspaceIds, loadWorkspaceManifest } from '../core/store';
import { hasSqliteStorage, storageErrorCode } from '../core/sqlite-store';
import {
  resolveWorkspaceId,
  WorkspaceResolutionError,
  type WorkspaceResolutionSource,
} from '../core/workspace-resolution';
import { probeRuntime, runtimeFilePath, type RuntimeStatus } from '../core/runtime-control';
import { output } from '../output';
import { getRootOptions } from './options';

interface StatusReport {
  storeDir: string;
  activeWorkspaceId: string | null;
  workspaceCount: number;
  storage: { backend: 'json' | 'sqlite' | 'unavailable'; error?: string; code?: string };
  resolved: {
    workspaceId: string | null;
    source: WorkspaceResolutionSource | null;
    error?: string;
    code?: string;
  };
  runtime: RuntimeStatus & { file: string };
}

export function registerStatusCommand(program: Command): void {
  program
    .command('status')
    .description('Report store, resolved workspace, and Electron runtime reachability (for external callers)')
    .action(async function (this: Command) {
      const { format, storeDir, workspace: explicitId } = getRootOptions(this);

      const manifest = await loadWorkspaceManifest(storeDir);
      let workspaceCount = 0;
      let storage: StatusReport['storage'];
      try {
        storage = { backend: await hasSqliteStorage(storeDir) ? 'sqlite' : 'json' };
        workspaceCount = (await listWorkspaceIds(storeDir)).length;
      } catch (error) {
        storage = { backend: 'unavailable', error: error instanceof Error ? error.message : String(error), code: storageErrorCode(error) };
      }

      // Best-effort resolution — this command must never exit non-zero just
      // because no workspace is selected; it reports that as data.
      const resolved: StatusReport['resolved'] = { workspaceId: null, source: null };
      try {
        const r = await resolveWorkspaceId({ explicitId, storeDir });
        resolved.workspaceId = r.workspaceId;
        resolved.source = r.source;
      } catch (err) {
        resolved.error = (err as Error).message;
        resolved.code = err instanceof WorkspaceResolutionError ? err.code : 'error';
      }

      const runtime = await probeRuntime();

      const report: StatusReport = {
        storeDir: storeDir ?? DEFAULT_STORE_DIR,
        activeWorkspaceId: manifest.activeId ?? null,
        workspaceCount,
        storage,
        resolved,
        runtime: { ...runtime, file: runtimeFilePath() },
      };

      output(report, format, (data) => {
        const d = data as StatusReport;
        const lines = [
          `Store dir:        ${d.storeDir}`,
          `Storage:          ${d.storage.backend}${d.storage.error ? ` — ${d.storage.error}` : ''}`,
          `Workspaces:       ${d.workspaceCount}`,
          `Active workspace: ${d.activeWorkspaceId ?? '(none)'}`,
          d.resolved.workspaceId
            ? `Resolves to:      ${d.resolved.workspaceId} (source: ${d.resolved.source})`
            : `Resolves to:      (none — ${d.resolved.error ?? 'no workspace selected'})`,
          d.runtime.reachable
            ? `Runtime:          reachable at ${d.runtime.baseUrl} (pid ${d.runtime.pid ?? '?'}) — live commands available`
            : `Runtime:          not available — ${d.runtime.error ?? 'unknown'}`,
        ];
        return lines.join('\n');
      });
    });
}
