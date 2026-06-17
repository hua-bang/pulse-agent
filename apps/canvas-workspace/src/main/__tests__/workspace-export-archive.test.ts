import { describe, expect, it } from 'vitest';
import {
  createWorkspaceExportArchive,
  createWorkspaceExportPayload,
  parseWorkspaceExportFile,
  type WorkspaceExportFile,
} from '../canvas/workspace-export-archive';

const makePayload = (files: WorkspaceExportFile[] = []) => createWorkspaceExportPayload({
  exportedAt: '2026-06-17T00:00:00.000Z',
  workspace: { id: 'ws-a', name: 'Research' },
  canvas: { nodes: [] },
  files,
});

describe('workspace export archive', () => {
  it('writes and reads a Pulse Canvas workspace zip archive', () => {
    const archive = createWorkspaceExportArchive(makePayload([
      { relativePath: 'notes/readme.md', encoding: 'base64', content: Buffer.from('hello').toString('base64') },
    ]));

    expect([...archive.subarray(0, 2)]).toEqual([0x50, 0x4b]);
    const parsed = parseWorkspaceExportFile(archive);
    expect(parsed.workspace).toEqual({ id: 'ws-a', name: 'Research' });
    expect(parsed.files).toHaveLength(1);
  });

  it('keeps backward compatibility with legacy JSON exports', () => {
    const legacy = Buffer.from(JSON.stringify(makePayload()), 'utf-8');

    expect(parseWorkspaceExportFile(legacy).workspace.name).toBe('Research');
  });

  it('rejects unsafe file paths from imported payloads', () => {
    const legacy = Buffer.from(JSON.stringify(makePayload([
      { relativePath: '../secret.txt', encoding: 'base64', content: '' },
    ])), 'utf-8');

    expect(() => parseWorkspaceExportFile(legacy)).toThrow(/unsafe file path/);
  });
});
