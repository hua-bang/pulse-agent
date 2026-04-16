/**
 * IPC handler for one-shot HTML generation.
 *
 * Channel:
 *   llm:generate-html — takes { prompt }, returns { ok, html?, error? }
 */

import { ipcMain } from 'electron';
import { generateHTML } from './html-generator';

export function setupHtmlGeneratorIpc(): void {
  ipcMain.handle(
    'llm:generate-html',
    async (_event, payload: { prompt: string }) => {
      if (!payload?.prompt?.trim()) {
        return { ok: false, error: 'Prompt is required' };
      }
      return generateHTML(payload.prompt.trim());
    },
  );
}
