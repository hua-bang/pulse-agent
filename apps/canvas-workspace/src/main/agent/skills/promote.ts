import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import type {
  CanvasSkillEntry,
  CanvasSkillPromoteResult,
} from '../../../shared/settings-config';
import { skillNameKey } from '../../../shared/skill-name';
import {
  getCanvasSkillsStatus,
  listCanvasSkills,
  skillSlug,
} from './config';
import { scopeSkillsDir } from '../config-scope';

export async function promoteCanvasSkill(
  workspaceId: string,
  name: string,
): Promise<CanvasSkillPromoteResult> {
  const workspaceScope = { level: 'workspace', workspaceId } as const;
  const globalScope = { level: 'global' } as const;
  const skills = await listCanvasSkills(workspaceScope);
  const match = skills.find(
    (skill) => skillNameKey(skill.name) === skillNameKey(name),
  );

  if (!match?.writable || match.source !== 'canvas') {
    throw new Error(`No writable workspace skill named "${name}"`);
  }

  const sourceDir = dirname(match.path);
  const globalSkillsDir = scopeSkillsDir(globalScope);
  const targetDir = join(globalSkillsDir, skillSlug(match.name));
  const tempDir = await fs.mkdtemp(join(tmpdir(), 'pulse-canvas-promote-'));
  const backupDir = join(tempDir, 'previous-global');
  let backupCreated = false;
  let localRemoved = false;
  try {
    await fs.mkdir(globalSkillsDir, { recursive: true });
    let targetExists = false;
    try {
      await fs.access(targetDir);
      targetExists = true;
    } catch {
      // No existing global Skill to preserve.
    }
    if (targetExists) {
      await fs.cp(targetDir, backupDir, { recursive: true });
      backupCreated = true;
    }
    await fs.rm(targetDir, { recursive: true, force: true });
    await fs.cp(sourceDir, targetDir, { recursive: true });
    await fs.rm(sourceDir, { recursive: true });
    localRemoved = true;
  } catch (error) {
    if (!localRemoved) {
      await fs.rm(targetDir, { recursive: true, force: true });
      if (backupCreated) await fs.cp(backupDir, targetDir, { recursive: true });
    }
    throw error;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
  const [globalStatus, workspaceStatus] = await Promise.all([
    getCanvasSkillsStatus(globalScope),
    getCanvasSkillsStatus(workspaceScope),
  ]);
  const promoted = globalStatus.skills.find(
    (skill) => skillNameKey(skill.name) === skillNameKey(match.name),
  );

  return {
    skill: promoted ?? ({
      ...match,
      scope: 'global',
      path: join(targetDir, 'SKILL.md'),
      resources: match.resources?.map((resource) => ({
        name: resource.name,
        path: join(targetDir, resource.name),
      })),
    } satisfies CanvasSkillEntry),
    globalStatus,
    workspaceStatus,
  };
}
