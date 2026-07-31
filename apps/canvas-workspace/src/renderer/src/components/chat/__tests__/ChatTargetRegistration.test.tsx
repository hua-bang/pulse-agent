// @vitest-environment happy-dom
import { act, useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import {
  ChatTargetProvider,
  type ChatTarget,
  useChatTargetBroker,
} from '../ChatTargetContext';
import { useRegisterChatTarget } from '../useRegisterChatTarget';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const target: ChatTarget = {
  surface: 'dock',
  scope: { kind: 'workspace', workspaceId: 'workspace-a' },
  scopeId: 'workspace-a',
  sessionId: null,
  composerId: 'dock:workspace-a',
  contextSnapshot: { label: 'Workspace A' },
  executionPolicy: 'auto',
};

describe('useRegisterChatTarget', () => {
  it('does not advertise handlers that the surface did not provide', async () => {
    let broker: ReturnType<typeof useChatTargetBroker> | undefined;
    const Probe = () => {
      broker = useChatTargetBroker();
      useRegisterChatTarget(target, { focus: () => undefined });
      return null;
    };
    const host = document.createElement('div');
    const root = createRoot(host);
    await act(async () => root.render(
      <ChatTargetProvider>
        <Probe />
      </ChatTargetProvider>,
    ));

    await expect(broker?.deliver({ kind: 'skill', skillName: 'review' }))
      .resolves.toEqual({ status: 'unavailable', target });

    act(() => root.unmount());
  });

  it('switches the receipt and handler together before layout consumers run', async () => {
    const workspaceBTarget: ChatTarget = {
      ...target,
      scope: { kind: 'workspace', workspaceId: 'workspace-b' },
      scopeId: 'workspace-b',
      composerId: 'dock:workspace-b',
      contextSnapshot: { label: 'Workspace B' },
    };
    const focusA = vi.fn();
    const focusB = vi.fn();
    const receipts: string[] = [];
    const Probe = ({
      nextTarget,
      focus,
      deliver,
    }: {
      nextTarget: ChatTarget;
      focus: () => void;
      deliver: boolean;
    }) => {
      const broker = useChatTargetBroker();
      useRegisterChatTarget(nextTarget, { focus });
      useLayoutEffect(() => {
        if (!deliver) return;
        void broker.deliver({ kind: 'focus' }).then(receipt => {
          receipts.push(receipt.target?.scopeId ?? 'none');
        });
      }, [broker, deliver]);
      return null;
    };
    const host = document.createElement('div');
    const root = createRoot(host);
    await act(async () => root.render(
      <ChatTargetProvider>
        <Probe nextTarget={target} focus={focusA} deliver={false} />
      </ChatTargetProvider>,
    ));
    await act(async () => root.render(
      <ChatTargetProvider>
        <Probe nextTarget={workspaceBTarget} focus={focusB} deliver />
      </ChatTargetProvider>,
    ));

    expect(receipts).toEqual(['workspace-b']);
    expect(focusA).not.toHaveBeenCalled();
    expect(focusB).toHaveBeenCalledOnce();
    act(() => root.unmount());
  });
});
