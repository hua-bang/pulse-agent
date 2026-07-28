import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  deleteAgentRole,
  getAgentRole,
  getAgentRoleSettings,
  listAgentRoles,
  saveAgentRole,
  saveAgentRoleSettings,
} from '../roles-store';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'canvas-roles-'));
  process.env.PULSE_CANVAS_AGENT_ROLES = join(dir, 'roles.json');
});

afterEach(() => {
  delete process.env.PULSE_CANVAS_AGENT_ROLES;
  rmSync(dir, { recursive: true, force: true });
});

describe('roles-store', () => {
  it('returns an empty library before any role exists', async () => {
    expect(await listAgentRoles()).toEqual([]);
  });

  it('creates, reads, updates, and deletes a role', async () => {
    const created = await saveAgentRole({ name: '产品经理', prompt: '你是资深产品经理。', color: '#D9730D' });
    expect(created.id).toMatch(/^role-/);
    expect(created.color).toBe('#d9730d');

    expect(await getAgentRole(created.id)).toMatchObject({ name: '产品经理' });

    const updated = await saveAgentRole({ id: created.id, name: '产品负责人', prompt: '新人设', color: '#2383e2' });
    expect(updated.id).toBe(created.id);
    expect(updated.createdAt).toBe(created.createdAt);
    expect(updated).toMatchObject({ name: '产品负责人', prompt: '新人设', color: '#2383e2' });
    expect(await listAgentRoles()).toHaveLength(1);

    expect(await deleteAgentRole(created.id)).toBe(true);
    expect(await deleteAgentRole(created.id)).toBe(false);
    expect(await listAgentRoles()).toEqual([]);
  });

  it('persists as JSON under the configured path', async () => {
    await saveAgentRole({ name: 'A', prompt: 'p' });
    const raw = JSON.parse(await readFile(process.env.PULSE_CANVAS_AGENT_ROLES!, 'utf8'));
    expect(raw.roles).toHaveLength(1);
  });

  it('rejects duplicate names (case-insensitive) and missing fields', async () => {
    await saveAgentRole({ name: 'Reviewer', prompt: 'p' });
    await expect(saveAgentRole({ name: 'reviewer', prompt: 'q' })).rejects.toThrow(/already exists/);
    await expect(saveAgentRole({ name: '   ', prompt: 'p' })).rejects.toThrow(/name/i);
    await expect(saveAgentRole({ name: 'X', prompt: '  ' })).rejects.toThrow(/prompt/i);
    await expect(saveAgentRole({ id: 'role-missing', name: 'Y', prompt: 'p' })).rejects.toThrow(/not found/i);
  });

  it('sanitizes marker syntax out of names and defaults invalid colors', async () => {
    const role = await saveAgentRole({ name: '评[审]|员', prompt: 'p', color: 'red' });
    expect(role.name).toBe('评审员');
    expect(role.color).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('assigns distinct default colors to successive roles', async () => {
    const first = await saveAgentRole({ name: 'A', prompt: 'p' });
    const second = await saveAgentRole({ name: 'B', prompt: 'p' });
    expect(second.color).not.toBe(first.color);
  });

  it('stores, updates, and clears the external driver with validation', async () => {
    const created = await saveAgentRole({
      name: 'Claude工程师', prompt: '写代码。',
      external: { family: 'claude-code', cwd: '/tmp/project' },
    });
    expect(created.external).toEqual({ family: 'claude-code', cwd: '/tmp/project' });

    // Absent → keep; null → clear; invalid → reject.
    const kept = await saveAgentRole({ id: created.id, name: 'Claude工程师', prompt: '写代码。' });
    expect(kept.external).toEqual({ family: 'claude-code', cwd: '/tmp/project' });

    await expect(saveAgentRole({
      id: created.id, name: 'Claude工程师', prompt: '写代码。',
      external: { family: 'vim' as never, cwd: '/tmp' },
    })).rejects.toThrow(/external driver/i);

    const cleared = await saveAgentRole({ id: created.id, name: 'Claude工程师', prompt: '写代码。', external: null });
    expect(cleared.external).toBeUndefined();
    expect((await listAgentRoles())[0].external).toBeUndefined();
  });

  it('defaults library settings to handoff OFF (legacy files included)', async () => {
    expect(await getAgentRoleSettings()).toEqual({ allowRoleHandoff: false });
    await saveAgentRole({ name: 'A', prompt: 'p' });
    expect(await getAgentRoleSettings()).toEqual({ allowRoleHandoff: false });
  });

  it('round-trips settings and normalizes junk input', async () => {
    expect(await saveAgentRoleSettings({ allowRoleHandoff: true })).toEqual({ allowRoleHandoff: true });
    expect(await getAgentRoleSettings()).toEqual({ allowRoleHandoff: true });
    expect(await saveAgentRoleSettings({ allowRoleHandoff: 'yes' as unknown as boolean })).toEqual({ allowRoleHandoff: false });
  });

  it('role saves and deletes preserve the settings, and settings saves preserve roles', async () => {
    await saveAgentRoleSettings({ allowRoleHandoff: true });
    const role = await saveAgentRole({ name: 'A', prompt: 'p' });
    expect(await getAgentRoleSettings()).toEqual({ allowRoleHandoff: true });

    await deleteAgentRole(role.id);
    expect(await getAgentRoleSettings()).toEqual({ allowRoleHandoff: true });

    await saveAgentRole({ name: 'B', prompt: 'p' });
    await saveAgentRoleSettings({ allowRoleHandoff: false });
    expect(await listAgentRoles()).toHaveLength(1);
  });
});
