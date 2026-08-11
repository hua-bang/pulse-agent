// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../i18n';
import type { AgentContextTabRef } from '../../../types';
import type { AgentScope } from '../types';
import { resetChatComposerDraftsForTests } from './chatComposerDraftStore';
import { useMentions } from './useMentions';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Hook = ReturnType<typeof useMentions>;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let latest: Hook | null = null;
const onSubmit = vi.fn(async () => true);

const Probe = ({ agentScope }: { agentScope: AgentScope }) => {
  latest = useMentions({
    agentScope,
    onSubmit,
  });
  return <div ref={latest.editableRef} contentEditable />;
};

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  latest = null;
  resetChatComposerDraftsForTests();
  vi.restoreAllMocks();
});

const renderScope = async (scope: AgentScope) => {
  if (!host) {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  }
  await act(async () => {
    root?.render(
      <I18nProvider>
        <Probe agentScope={scope} />
      </I18nProvider>,
    );
  });
};

const openSkillMentions = async () => {
  const editable = latest?.editableRef.current;
  if (!editable) throw new Error('composer did not mount');
  editable.textContent = '/';
  const textNode = editable.firstChild;
  if (!textNode) throw new Error('composer text node did not mount');
  const range = document.createRange();
  range.setStart(textNode, 1);
  range.collapse(true);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  await act(async () => {
    latest?.handleInput();
    await Promise.resolve();
  });
};

describe('scope-keyed composer state', () => {
  it('inserts a dock tab as a structured composer mention', async () => {
    const tab: AgentContextTabRef = {
      id: 'canvas:workspace-a',
      kind: 'canvas',
      title: 'Workspace A',
      workspaceId: 'workspace-a',
      dockWorkspaceId: 'workspace-a',
    };
    await renderScope({ kind: 'global' });

    act(() => latest?.insertTabMention(tab));

    const chip = latest?.editableRef.current?.querySelector<HTMLElement>('[data-mention-kind="tab"]');
    expect(chip?.dataset.tabId).toBe(tab.id);
    expect(chip?.textContent).toContain('Workspace A');
    expect(latest?.input).toContain('@[tab:');
  });

  it('keeps each scope draft isolated and restores it when returning', async () => {
    await renderScope({ kind: 'global' });
    act(() => latest?.replaceInput('global draft'));
    expect(latest?.input).toBe('global draft');

    await renderScope({ kind: 'workspace', workspaceId: 'workspace-a' });
    expect(latest?.input).toBe('');
    expect(latest?.editableRef.current?.textContent).toBe('');

    act(() => latest?.replaceInput('workspace draft'));
    expect(latest?.input).toBe('workspace draft');

    await renderScope({ kind: 'global' });
    expect(latest?.input).toBe('global draft');
    expect(latest?.editableRef.current?.textContent).toBe('global draft');
  });

  it('keeps workspace attachments isolated and rejects them in global scope', async () => {
    const saveImage = vi.fn(async () => ({
      ok: true,
      filePath: '/tmp/workspace-image.png',
    }));
    Object.defineProperty(window, 'canvasWorkspace', {
      configurable: true,
      value: {
        file: { saveImage },
      },
    });
    await renderScope({ kind: 'workspace', workspaceId: 'workspace-a' });

    await act(async () => {
      latest?.handleAttachFiles([
        new File(['image'], 'context.png', { type: 'image/png' }),
      ]);
    });
    await act(async () => {
      await vi.waitFor(() => expect(saveImage).toHaveBeenCalledTimes(1));
      await Promise.resolve();
    });

    await renderScope({ kind: 'global' });
    expect(latest?.attachments).toEqual([]);
    act(() => latest?.handleAttachFiles([
      new File(['image'], 'unsupported.png', { type: 'image/png' }),
    ]));
    expect(latest?.attachments).toEqual([]);

    await renderScope({ kind: 'workspace', workspaceId: 'workspace-a' });
    expect(latest?.attachments).toHaveLength(1);
    expect(saveImage).toHaveBeenCalledTimes(1);
  });

  it('loads Skill candidates per scope instead of reusing another scope cache', async () => {
    const listSkills = vi.fn(async ({ scope }: { scope: AgentScope }) => ({
      ok: true,
      skills: [{
        name: scope.kind === 'workspace' ? 'workspace-skill' : 'global-skill',
        description: '',
      }],
    }));
    Object.defineProperty(window, 'canvasWorkspace', {
      configurable: true,
      value: {
        agent: { listSkills },
      },
    });

    await renderScope({ kind: 'global' });
    await openSkillMentions();
    await vi.waitFor(() => expect(listSkills).toHaveBeenCalled());
    expect(listSkills).toHaveBeenLastCalledWith({ scope: { kind: 'global' } });

    await renderScope({ kind: 'workspace', workspaceId: 'workspace-a' });
    await openSkillMentions();
    expect(listSkills).toHaveBeenLastCalledWith({
      scope: { kind: 'workspace', workspaceId: 'workspace-a' },
    });

    await renderScope({ kind: 'global' });
    await openSkillMentions();
    expect(listSkills).toHaveBeenCalledTimes(2);
  });
});
