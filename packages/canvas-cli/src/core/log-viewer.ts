import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { promisify } from 'util';
import { viewerScript, viewerStyles } from '../generated/log-viewer';
import { LogError, type LogSelector, type RecordedLogRun } from './logs';

const execFileAsync = promisify(execFile);

export function buildLogViewerHtml(payload: {
  runs: RecordedLogRun[];
  selectedRunId?: string;
  sessionId?: string;
  workspaceId: string;
}): string {
  const json = JSON.stringify(payload).replace(/[<>&\u2028\u2029]/g,
    character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pulse Canvas DevTools</title><style>${viewerStyles}</style></head>
<body><div id="root"></div><script id="trace-data" type="application/json">${json}</script>
<script>${viewerScript.replace(/<\/script/gi, '<\\/script')}</script></body></html>`;
}

export async function openLogViewer(
  runs: RecordedLogRun[], selector: LogSelector, workspaceId: string,
): Promise<{ opened: true; path: string }> {
  if (!runs.length) throw new LogError('session_not_found', `No recorded runs for session ${selector.sessionId}.`);
  const directory = await fs.mkdtemp(join(tmpdir(), 'pulse-canvas-log-'));
  const path = join(directory, 'devtools.html');
  try {
    await fs.writeFile(path, buildLogViewerHtml({
      runs, workspaceId, selectedRunId: selector.runId, sessionId: selector.sessionId,
    }), { mode: 0o600 });
    const url = pathToFileURL(path).href;
    if (process.platform === 'darwin') await execFileAsync('open', [url]);
    else if (process.platform === 'win32') {
      // Avoid a cmd.exe shell: the file URL is passed as one native argument.
      await execFileAsync('rundll32.exe', ['url.dll,FileProtocolHandler', url]);
    } else await execFileAsync('xdg-open', [url]);
    return { opened: true, path };
  } catch (error) {
    await fs.rm(directory, { recursive: true, force: true });
    throw new LogError('viewer_open_failed', `Cannot open DevTools viewer: ${error instanceof Error ? error.message : String(error)}`);
  }
}
