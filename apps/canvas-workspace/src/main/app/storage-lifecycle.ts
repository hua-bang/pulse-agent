import { app, dialog } from 'electron';
import { recoverLocalFileWrites } from '@pulse-coder/storage/local-files';
import { closeCanvasStorage, getCanvasBackend, getLocalCanvasStorage } from '../canvas/persistence/backend';
import { STORE_DIR } from '../canvas/persistence/paths';
import { stopSqliteCanvasObserver } from '../canvas/sqlite-ipc';
import { closeSqliteSessionStorage, getSqliteSessionStorage } from '../agent/sqlite-session-backend';
import { setCanvasSessionArchivePort } from '../canvas/persistence/session-archive-port';
import type { WriteLog } from './logging';

/** Finish verified cutovers before IPC, Agents, plugins, or welcome seeding can write. */
export async function startStorage(writeLog: WriteLog): Promise<boolean> {
  try {
    if (!await getCanvasBackend(STORE_DIR)) {
      const { activateCanvasSqliteAtStartup } = await import('../canvas/persistence/activate-sqlite');
      await activateCanvasSqliteAtStartup(writeLog);
    }
    if (!await getSqliteSessionStorage()) {
      const { activateSqliteSessions } = await import('../agent/sqlite-session-migration');
      const skipped = await activateSqliteSessions();
      if (skipped.length) {
        await writeLog('storage', 'Skipped unreadable legacy session files', JSON.stringify(skipped));
        // Informational only: startup must not wait for the user to dismiss it.
        void dialog.showMessageBox({
          type: 'warning',
          title: 'Pulse Canvas',
          message: `有 ${skipped.length} 个聊天记录文件无法读取，未被迁移`,
          detail: '其余聊天记录已正常迁移。以下原始文件保持原样，未被修改或删除：\n\n'
            + skipped.map(file => file.path).join('\n'),
        }).catch(() => undefined);
      }
    }
    setCanvasSessionArchivePort(() => import('../agent/workspace-session-archive')
      .then(module => module.createCanvasSessionArchivePort()));
    const store = await getLocalCanvasStorage(STORE_DIR);
    if (!store) throw new Error('Canvas storage did not activate.');
    const recovery = await recoverLocalFileWrites(store);
    if (!recovery.ok) {
      await writeLog('storage', 'Some file writes need recovery', JSON.stringify({
        conflicts: recovery.conflicts, errors: recovery.errors,
      }));
    }
    // Lazy chunk: keeps recovery out of the main bundle; it logs and never blocks startup.
    await import('../canvas/persistence/import-recovery')
      .then(module => module.recoverImportsAtStartup(STORE_DIR, store, writeLog)).catch(() => undefined);
    return true;
  } catch (error) {
    await writeLog('storage', 'Storage upgrade failed', String(error));
    await stopStorage().catch(() => undefined);
    dialog.showErrorBox('Pulse Canvas 数据暂时无法打开',
      '数据迁移或校验未完成，应用已停止启动。原始 JSON、Markdown 和附件不会被删除。'
      + '\n请保留数据目录及其中的备份；修复错误后重新打开，迁移会继续。'
      + `\n\n${error instanceof Error ? error.message : String(error)}`);
    app.quit();
    return false;
  }
}

/** Call only after runtime writers have drained. Normal window closing keeps stores available. */
export async function stopStorage(): Promise<void> {
  stopSqliteCanvasObserver();
  await Promise.all([closeSqliteSessionStorage(), closeCanvasStorage()]);
}

/** A stuck provider may delay shutdown, but must never write into an already closed store. */
export async function stopStorageAfterWriters(
  drainWriters: () => Promise<void>,
  writeLog: WriteLog,
  timeoutMs = 5000,
): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const draining = Promise.resolve().then(drainWriters).then(() => true, error => {
    void writeLog('storage', 'Writer shutdown failed; leaving database handles to process exit', String(error));
    return false;
  });
  const timeout = new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), timeoutMs); });
  try {
    const drained = await Promise.race([draining, timeout]);
    if (drained) await stopStorage();
    else await writeLog('storage', 'Writers did not drain; committed data remains durable and process exit will close storage');
    return drained;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
