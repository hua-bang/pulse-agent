// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getRoleColors,
  invalidateRoleMentionItems,
  isExternalOnlyRoleMessage,
  loadRoleMentionItems,
  subscribeRoleColors,
} from './roleMentionItems';
import { notifyRoleLibraryChanged } from '../../../shared/roleLibraryEvents';

type RoleRow = {
  id: string; name: string; color: string; prompt: string;
  external?: { family: 'claude-code' | 'codex'; cwd: string };
};

const stubRoles = (roles: RoleRow[]) => {
  const list = vi.fn(async () => ({ ok: true as const, roles }));
  (window as any).canvasWorkspace = { agentRoles: { list } };
  return list;
};

afterEach(() => {
  delete (window as any).canvasWorkspace;
});

describe('role mention cache', () => {
  it('publishes id → color on load and serves repeat reads from the TTL cache', async () => {
    const list = stubRoles([
      { id: 'role-1', name: '产品经理', color: '#d9730d', prompt: 'PM 视角,先问价值' },
      { id: 'role-2', name: '评审员', color: '#2383e2', prompt: '专挑毛病' },
    ]);
    await invalidateRoleMentionItems();

    expect(getRoleColors().get('role-1')).toBe('#d9730d');
    expect(getRoleColors().get('role-2')).toBe('#2383e2');

    const callsAfterLoad = list.mock.calls.length;
    const items = await loadRoleMentionItems();
    expect(items[0]).toMatchObject({ type: 'role', roleId: 'role-1', roleColor: '#d9730d' });
    expect(list.mock.calls.length).toBe(callsAfterLoad);
  });

  it('notifies subscribers on a recolor and stays quiet when nothing changed', async () => {
    stubRoles([{ id: 'role-1', name: 'PM', color: '#d9730d', prompt: 'p' }]);
    await invalidateRoleMentionItems();

    const seen: Array<string | undefined> = [];
    const unsubscribe = subscribeRoleColors(() => {
      seen.push(getRoleColors().get('role-1'));
    });

    stubRoles([{ id: 'role-1', name: 'PM', color: '#0f7b6c', prompt: 'p' }]);
    await invalidateRoleMentionItems();
    expect(seen).toEqual(['#0f7b6c']);

    await invalidateRoleMentionItems();
    expect(seen).toEqual(['#0f7b6c']);
    unsubscribe();
  });

  it('refreshes when the settings-owned role library publishes a change', async () => {
    const list = stubRoles([{ id: 'role-1', name: 'PM', color: '#d9730d', prompt: 'p' }]);
    await invalidateRoleMentionItems();
    list.mockClear();
    await notifyRoleLibraryChanged();
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('lets external-only turns through the no-provider guard, and nothing else', async () => {
    stubRoles([
      { id: 'r-ext', name: 'Claude工程师', color: '#2383e2', prompt: 'p', external: { family: 'claude-code', cwd: '/tmp/x' } },
      { id: 'r-p', name: '评审员', color: '#0f7b6c', prompt: 'p' },
    ]);
    await invalidateRoleMentionItems();

    expect(isExternalOnlyRoleMessage('@[role:r-ext|Claude工程师] 修一下')).toBe(true);
    expect(isExternalOnlyRoleMessage('@[role:r-p|评审员] 看看')).toBe(false);
    expect(isExternalOnlyRoleMessage('@[role:r-ext|Claude工程师] @[role:r-p|评审员] 一起')).toBe(false);
    expect(isExternalOnlyRoleMessage('没有点名任何人')).toBe(false);
    expect(isExternalOnlyRoleMessage('@[role:r-unknown|谁] hi')).toBe(false);
  });

  it('clears the color map when the library read fails, so chips fall back to violet', async () => {
    stubRoles([{ id: 'role-1', name: 'PM', color: '#d9730d', prompt: 'p' }]);
    await invalidateRoleMentionItems();
    expect(getRoleColors().size).toBe(1);

    (window as any).canvasWorkspace = {
      agentRoles: { list: async () => { throw new Error('ipc down'); } },
    };
    await invalidateRoleMentionItems();
    expect(getRoleColors().size).toBe(0);
  });
});
