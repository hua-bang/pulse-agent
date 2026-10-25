import { describe, expect, it, vi } from 'vitest';
import { confirmAndDeleteWorkspace } from './workspaceDeleteFlow';

const setup = (switchedActive: boolean) => {
  const updateToast = vi.fn();
  const deps = {
    confirm: vi.fn(async () => true),
    notify: vi.fn(() => 'toast-1'),
    updateToast,
    t: (key: string) => key,
    deleteWorkspace: vi.fn(async () => ({ ok: true, switchedActive, newActiveId: 'b', switchedToEmpty: false })),
    restoreDeletedWorkspace: vi.fn(async () => ({ ok: true })),
    select: vi.fn(),
    enterChatView: vi.fn(),
  };
  const undo = async () => {
    const patch = updateToast.mock.calls.at(-1)?.[1] as { action?: { onClick: () => void } };
    patch.action?.onClick();
    await vi.waitFor(() => expect(deps.restoreDeletedWorkspace).toHaveBeenCalled());
    await Promise.resolve();
  };
  return { deps, undo };
};

describe('confirmAndDeleteWorkspace', () => {
  it('offers Undo that restores the workspace and switches back to it', async () => {
    const { deps, undo } = setup(true);
    await confirmAndDeleteWorkspace({ id: 'a', name: 'Alpha' }, 2, deps);
    expect(deps.deleteWorkspace).toHaveBeenCalledWith('a');

    await undo();

    expect(deps.restoreDeletedWorkspace).toHaveBeenCalledWith('a', 2);
    await vi.waitFor(() => expect(deps.select).toHaveBeenCalledWith('a'));
  });

  it('keeps the current workspace when the deleted one was not active', async () => {
    const { deps, undo } = setup(false);
    await confirmAndDeleteWorkspace({ id: 'a', name: 'Alpha' }, 0, deps);
    await undo();
    await vi.waitFor(() => expect(deps.notify).toHaveBeenCalledTimes(2));
    expect(deps.select).not.toHaveBeenCalled();
  });
});
