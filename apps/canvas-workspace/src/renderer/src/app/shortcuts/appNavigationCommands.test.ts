import { describe, expect, it, vi } from 'vitest';
import { buildAppNavigationCommands } from './appNavigationCommands';

const routes = {
  canvas: '/',
  chat: '/chat',
  home: '/home',
  plugins: '/plugins',
  scheduled: '/scheduled',
  skills: '/skills',
};

describe('buildAppNavigationCommands', () => {
  const build = () => {
    const selectWorkspace = vi.fn();
    const setLocation = vi.fn();
    const commands = buildAppNavigationCommands({
      workspaces: [{ id: 'w1', name: 'Research' }],
      routes,
      selectWorkspace,
      setLocation,
      t: (key, params) => (params?.name ? `${key}:${params.name}` : key),
    });
    return { commands, selectWorkspace, setLocation };
  };

  it('lists pages before workspaces', () => {
    const { commands } = build();
    expect(commands.map((command) => command.id)).toEqual([
      'page:home',
      'page:chat',
      'page:plugins',
      'page:scheduled',
      'page:skills',
      'page:settings',
      'workspace:w1',
    ]);
  });

  it('opens a workspace on the canvas route', () => {
    const { commands, selectWorkspace, setLocation } = build();
    const workspace = commands.find((command) => command.id === 'workspace:w1');
    expect(workspace?.aliases).toContain('Research');
    workspace?.run();
    expect(selectWorkspace).toHaveBeenCalledWith('w1');
    expect(setLocation).toHaveBeenCalledWith('/');
  });

  it('goes to a page route', () => {
    const { commands, setLocation } = build();
    commands.find((command) => command.id === 'page:scheduled')?.run();
    expect(setLocation).toHaveBeenCalledWith('/scheduled');
  });
});
