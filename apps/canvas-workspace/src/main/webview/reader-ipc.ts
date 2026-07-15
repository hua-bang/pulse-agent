import { ipcMain } from 'electron';
import type { WebReadInput, WebReadResult } from './reader';

export function setupWebpageReaderIpc(): void {
  ipcMain.handle(
    'web:read',
    async (_event: unknown, payload: WebReadInput): Promise<WebReadResult> =>
      (await import('./reader-ipc-handler')).handleWebRead(payload),
  );
}
