import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanvasSkillEntry, CanvasSkillsStatus } from '../../../shared/settings-config';

const mocks = vi.hoisted(() => ({
  getCanvasSkillsStatus: vi.fn(),
  listCanvasSkills: vi.fn(),
  skillSlug: vi.fn((name: string) => name),
}));
const fsMocks = vi.hoisted(() => ({
  access: vi.fn(),
  cp: vi.fn(),
  mkdir: vi.fn(),
  mkdtemp: vi.fn(),
  rm: vi.fn(),
}));

vi.mock('./config', () => mocks);
vi.mock('../config-scope', () => ({ scopeSkillsDir: () => '/global/skills' }));
vi.mock('fs', () => ({ promises: fsMocks }));
vi.mock('os', () => ({ tmpdir: () => '/tmp' }));

import { promoteCanvasSkill } from './promote';

const workspaceSkill: CanvasSkillEntry = {
  name: 'release-canvas',
  description: 'Prepare a release.',
  body: '# Release\n\nValidate the workspace.',
  scope: 'workspace',
  path: '/workspace/skills/release-canvas/SKILL.md',
  source: 'canvas',
  writable: true,
};

const workspaceStatus: CanvasSkillsStatus = {
  scope: 'workspace',
  dir: '/workspace/skills',
  skills: [],
};

const globalStatus: CanvasSkillsStatus = {
  scope: 'global',
  dir: '/global/skills',
  skills: [{ ...workspaceSkill, scope: 'global', path: '/global/skills/release-canvas/SKILL.md' }],
};

describe('promoteCanvasSkill', () => {
  beforeEach(() => {
    mocks.getCanvasSkillsStatus.mockReset();
    mocks.listCanvasSkills.mockReset();
    fsMocks.access.mockReset();
    fsMocks.cp.mockReset();
    fsMocks.mkdir.mockReset();
    fsMocks.mkdtemp.mockReset();
    fsMocks.rm.mockReset();
    mocks.listCanvasSkills.mockResolvedValue([workspaceSkill]);
    mocks.getCanvasSkillsStatus.mockImplementation(async (scope: { level: string }) => (
      scope.level === 'global' ? globalStatus : workspaceStatus
    ));
    fsMocks.access.mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }));
    fsMocks.mkdtemp.mockResolvedValue('/tmp/pulse-canvas-promote-test');
  });

  it('moves the complete workspace skill directory to global', async () => {
    const result = await promoteCanvasSkill('workspace-1', 'release-canvas');

    expect(fsMocks.cp).toHaveBeenCalledWith(
      '/workspace/skills/release-canvas',
      '/global/skills/release-canvas',
      { recursive: true },
    );
    expect(fsMocks.rm).toHaveBeenCalledWith(
      '/workspace/skills/release-canvas',
      { recursive: true },
    );
    expect(result).toEqual({
      skill: globalStatus.skills[0],
      globalStatus,
      workspaceStatus,
    });
  });

  it('rejects a missing or read-only workspace skill before writing global state', async () => {
    mocks.listCanvasSkills.mockResolvedValue([{ ...workspaceSkill, writable: false }]);

    await expect(promoteCanvasSkill('workspace-1', 'release-canvas')).rejects.toThrow(
      'No writable workspace skill',
    );
    expect(fsMocks.cp).not.toHaveBeenCalled();
  });

  it('restores the previous global skill when removing the workspace copy fails', async () => {
    fsMocks.access.mockResolvedValue(undefined);
    fsMocks.rm.mockImplementation(async (path: string) => {
      if (path === '/workspace/skills/release-canvas') throw new Error('busy');
    });

    await expect(promoteCanvasSkill('workspace-1', 'release-canvas')).rejects.toThrow('busy');

    expect(fsMocks.cp).toHaveBeenCalledWith(
      '/tmp/pulse-canvas-promote-test/previous-global',
      '/global/skills/release-canvas',
      { recursive: true },
    );
  });
});
