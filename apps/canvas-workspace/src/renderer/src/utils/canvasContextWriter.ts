import type { CanvasNode, FileNodeData } from '../types';
import type { Terminal } from '@xterm/xterm';

const extractDescription = (content: string): string => {
  const lines = content.split('\n').map(l => l.trim()).filter(Boolean);
  for (const line of lines) {
    const heading = line.match(/^#{1,3}\s+(.+)/);
    if (heading) return heading[1];
    if (/^[-*_]{3,}$/.test(line)) continue;
    return line.replace(/[*_`#>]/g, '').trim().slice(0, 80);
  }
  return '';
};

const buildCanvasContext = (
  nodes: CanvasNode[],
  workspaceFolder: string,
  workspaceId?: string,
  workspaceName?: string,
  canvasDir?: string,
): string => {
  const fileNodes = nodes.filter(n => n.type === 'file');
  if (fileNodes.length === 0 && !canvasDir) return '';

  const label = workspaceName
    ? `${workspaceName}${workspaceId ? ` (${workspaceId})` : ''}`
    : (workspaceId ?? 'default');

  const lines = [
    '# Pulse Canvas Context',
    '',
    `Workspace: ${label}`,
    `Folder: ${workspaceFolder}`,
  ];

  if (workspaceId) {
    lines.push('', '## Workspace Isolation');
    lines.push('', `Environment variable \`PULSE_CANVAS_WORKSPACE_ID=${workspaceId}\` is injected into this terminal session.`);
    lines.push('Use this to scope all canvas operations to the current workspace and avoid reading/writing nodes from other canvases.');
    lines.push('When calling MCP canvas tools, always pass this workspace ID to ensure isolation.');
  }

  if (canvasDir) {
    lines.push(`Canvas dir: ${canvasDir}`);
    lines.push(`Canvas data: ${canvasDir}/canvas.json`);
    lines.push(`Notes dir: ${canvasDir}/notes/`);
  }

  if (fileNodes.length > 0) {
    lines.push('', '## Files on Canvas', '');
    for (const node of fileNodes) {
      const d = node.data as FileNodeData;
      const pathHint = d.filePath ? `\`${d.filePath}\`` : '(unsaved)';
      const desc = extractDescription(d.content);
      lines.push(`- **${node.title}** ${pathHint}${desc ? ` — ${desc}` : ''}`);
    }
  }

  lines.push('', '> Use the file paths above to read content as needed.', '');
  return lines.join('\n');
};

/**
 * Commands that trigger lazy canvas context refresh. Originally also
 * injected a marker block into the user's `<cwd>/CLAUDE.md` and
 * `<cwd>/AGENTS.md` so external coding agents would discover the
 * workspace on launch — that path is disabled for now (we don't want to
 * silently modify project files). The internal `<canvasDir>/AGENTS.md`
 * snapshot is still refreshed because the Canvas Agent's context-builder
 * reads it for its own prompt.
 */
export const AI_TOOL_PATTERN = /\b(claude|codex|pulse-coder|pulsecoder)\b/;

const writeCanvasAgentsMd = async (
  fileApi: NonNullable<typeof window.canvasWorkspace>['file'],
  canvasDir: string,
  context: string,
): Promise<void> => {
  const existing = await fileApi.read(`${canvasDir}/AGENTS.md`).then(r => (r.ok ? r.content ?? '' : ''));
  const AUTO_START = '<!-- canvas:auto-start -->';
  const AUTO_END = '<!-- canvas:auto-end -->';
  const autoBlock = `${AUTO_START}\n${context}\n${AUTO_END}`;
  const startIdx = existing.indexOf(AUTO_START);
  const endIdx = existing.indexOf(AUTO_END);
  let updated: string;
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    updated = existing.slice(0, startIdx) + autoBlock + existing.slice(endIdx + AUTO_END.length);
  } else {
    updated = existing.trimEnd()
      ? `${existing.trimEnd()}\n\n${autoBlock}\n`
      : `${autoBlock}\n`;
  }
  await fileApi.write(`${canvasDir}/AGENTS.md`, updated);
};

export const writeCanvasContext = async (
  nodes: CanvasNode[],
  cwd: string,
  workspaceId?: string,
  workspaceName?: string,
  term?: Terminal,
): Promise<void> => {
  const storeApi = window.canvasWorkspace?.store;
  const fileApi = window.canvasWorkspace?.file;
  if (!storeApi || !fileApi) return;

  const wsId = workspaceId ?? 'default';

  const dirRes = await storeApi.getDir(wsId);
  if (!dirRes.ok || !dirRes.dir) return;
  const canvasDir: string = dirRes.dir;

  const context = buildCanvasContext(nodes, cwd, workspaceId, workspaceName, canvasDir);
  if (!context) return;

  // Only the internal canvasDir snapshot is refreshed. We intentionally
  // do NOT write into the user's `<cwd>/CLAUDE.md` or `<cwd>/AGENTS.md`
  // anymore — Pulse should not silently modify project files.
  await writeCanvasAgentsMd(fileApi, canvasDir, context);

  if (term) {
    term.writeln(
      `\x1b[2m[canvas] canvas/AGENTS.md updated (project CLAUDE.md / AGENTS.md left untouched)\x1b[0m`
    );
  }
};
