// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { registerWorkspacePersistence } from '../../../../../shared/workspacePersistence';
import { useMcpAppNodeContext } from '../useMcpAppNodeContext';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const target = {
  workspaceId: 'new-node-workspace', nodeId: 'fresh-node', serverName: 'bits',
  toolName: 'library', resourceUri: 'ui://bits/app',
};
const result = { structuredContent: { page: 'library' } };

describe('new MCP App node persistence ordering', () => {
  it.each([false, true])('waits for the existing document writer before retrying registration (unmount=%s)', async (unmount) => {
    let finishSave!: () => void;
    const saving = new Promise<void>(resolve => { finishSave = resolve; });
    const flush = vi.fn(() => saving);
    const unregister = registerWorkspacePersistence(target.workspaceId, flush);
    const openNodeContext = vi.fn()
      .mockResolvedValueOnce({ ok: false, code: 'node-not-persisted', error: 'not saved yet' })
      .mockResolvedValue({ ok: true, token: 'saved-node' });
    const updateNodeContext = vi.fn().mockResolvedValue({ ok: true });
    const closeNodeContext = vi.fn().mockResolvedValue({ ok: true });
    (window as any).canvasWorkspace = { agent: { mcpApps: { openNodeContext, updateNodeContext, closeNodeContext } } };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const Probe = () => { useMcpAppNodeContext(target, result); return null; };
    const root = createRoot(document.createElement('div'));
    let mounted = true;
    try {
      await act(async () => { root.render(<Probe />); });
      expect(flush).toHaveBeenCalledOnce();
      expect(openNodeContext).toHaveBeenCalledTimes(1);
      expect(updateNodeContext).not.toHaveBeenCalled();
      if (unmount) {
        await act(async () => { root.unmount(); });
        mounted = false;
      }
      await act(async () => { finishSave(); await saving; });
      expect(openNodeContext).toHaveBeenCalledTimes(unmount ? 1 : 2);
      if (!unmount) expect(updateNodeContext).toHaveBeenCalledWith('saved-node', 'tool-result', result);
    } finally {
      if (mounted) await act(async () => { root.unmount(); });
      unregister();
      warn.mockRestore();
    }
  });
});
