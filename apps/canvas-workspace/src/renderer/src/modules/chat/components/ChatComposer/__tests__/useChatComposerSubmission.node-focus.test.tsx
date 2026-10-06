// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi, type Mock } from 'vitest';
import { globalMcpAppsStore } from '../../../../mcp-apps/global-apps';
import { useChatComposerSubmission } from '../useChatComposerSubmission';
import type { AgentRequestContext, ChatRunInputMode } from '../../../../../types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const implicit = { id: 'other-node', title: 'Other document', type: 'file' as const, workspaceId: 'ws-1' };
const mentioned = { id: 'app-node', title: 'Bits & Bolts', type: 'plugin' as const, workspaceId: 'ws-2' };

async function withSubmission(chips: string, verify: (
  hook: ReturnType<typeof useChatComposerSubmission>,
  submit: Mock<[string, AgentRequestContext?], Promise<boolean>>,
  duringRun: Mock<[ChatRunInputMode, string, AgentRequestContext?], Promise<boolean>>,
) => Promise<void>) {
  const editable = document.createElement('div');
  editable.innerHTML = chips;
  const submit = vi.fn(async (_text: string, _context?: AgentRequestContext) => true);
  const duringRun = vi.fn(async (_mode: ChatRunInputMode, _text: string, _context?: AgentRequestContext) => true);
  const context: AgentRequestContext = { selectedNodes: [implicit], executionMode: 'ask' };
  let hook!: ReturnType<typeof useChatComposerSubmission>;
  const Probe = () => {
    hook = useChatComposerSubmission({
      attachments: [], attachmentSendBlocked: false, clearInput: vi.fn(), collectStructuredContext: true,
      editableRef: { current: editable }, getRequestContext: () => context, input: '总结',
      onSubmit: submit, onSubmitDuringRun: duringRun,
    });
    return null;
  };
  const root = createRoot(document.createElement('div'));
  try {
    await act(async () => { root.render(<Probe />); });
    await verify(hook, submit, duringRun);
    expect(context.selectedNodes).toEqual([implicit]);
  } finally {
    await act(async () => { root.unmount(); });
  }
}

describe('composer explicit node focus', () => {
  it('uses the @-mentioned node instead of an unrelated canvas selection on both submit paths', async () => {
    await withSubmission(`<span data-mention-kind="node" data-node-id="app-node" data-node-type="plugin" data-workspace-id="ws-2">
      <span class="chat-mention-chip-label">Bits & Bolts</span></span>`, async (hook, submit, duringRun) => {
      await act(async () => { await hook.submitCurrentInput(); });
      expect(submit.mock.calls[0][1]).toMatchObject({ selectedNodes: [mentioned], executionMode: 'ask', scope: 'selected_nodes' });
      await act(async () => { await hook.submitCurrentInputDuringRun('follow-up'); });
      expect(duringRun.mock.calls[0]).toEqual(['follow-up', '总结', expect.objectContaining({ selectedNodes: [mentioned] })]);
    });
  });

  it('freezes the visible global App on ordinary and queued submissions', async () => {
    globalMcpAppsStore.open({ serverName: 'drawings', toolName: 'library', resourceUri: 'ui://library', title: 'Drawings', kind: 'global' });
    const app = globalMcpAppsStore.getSnapshot().running[0];
    globalMcpAppsStore.setActive(app.key);
    const publish = (text: string) => globalMcpAppsStore.publishContext(app, 'visible-ui', { content: [{ type: 'text', text }] });
    try {
      publish('Search: today');
      await withSubmission('', async (hook, submit, duringRun) => {
        await act(async () => { await hook.submitCurrentInput(); });
        publish('Search: architecture');
        await act(async () => { await hook.submitCurrentInputDuringRun('follow-up'); });
        expect(submit.mock.calls[0][1]?.mcpAppContext?.snapshots[0].text).toBe('Search: today');
        expect(duringRun.mock.calls[0][2]?.mcpAppContext?.snapshots[0].text).toBe('Search: architecture');
        globalMcpAppsStore.setActive(null);
        await act(async () => { await hook.submitCurrentInput(); });
        expect(submit.mock.calls[1][1]?.mcpAppContext).toBeUndefined();
      });
    } finally {
      globalMcpAppsStore.close(app.key);
      globalMcpAppsStore.setActive(null);
    }
  });

  it('retains canvas selection when the composer has no node mention', async () => {
    await withSubmission('<span data-mention-kind="tag" data-tag="CAD"><span class="chat-mention-chip-label">CAD</span></span>', async (hook, submit) => {
      await act(async () => { await hook.submitCurrentInput(); });
      expect(submit.mock.calls[0][1]).toMatchObject({ selectedNodes: [implicit], tags: [{ name: 'CAD' }] });
    });
  });

  it('keeps all explicitly mentioned nodes, including identical ids in distinct workspaces', async () => {
    await withSubmission(['ws-2', 'ws-3'].map(workspaceId => `<span data-mention-kind="node" data-node-id="app-node" data-node-type="plugin" data-workspace-id="${workspaceId}"><span class="chat-mention-chip-label">Bits & Bolts</span></span>`).join(''), async (hook, submit) => {
      await act(async () => { await hook.submitCurrentInput(); });
      expect(submit.mock.calls[0][1]?.selectedNodes).toEqual([mentioned, { ...mentioned, workspaceId: 'ws-3' }]);
    });
  });
});
