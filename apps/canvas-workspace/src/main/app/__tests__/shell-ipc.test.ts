import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
  },
  shell: {
    openExternal: vi.fn(),
  },
}));

describe('shell IPC URL policy', () => {
  it('allows VS Code editor protocols', async () => {
    const { isSafeExternalUrl } = await import('../shell-ipc');

    expect(isSafeExternalUrl('vscode://file/root/project/src/App.tsx:12:3')).toBe(true);
    expect(isSafeExternalUrl('vscode-insiders://file/root/project/src/App.tsx:12:3')).toBe(true);
  });

  it('continues to reject unsafe local and script protocols', async () => {
    const { isSafeExternalUrl } = await import('../shell-ipc');

    expect(isSafeExternalUrl('file:///root/project/src/App.tsx')).toBe(false);
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false);
  });
});
