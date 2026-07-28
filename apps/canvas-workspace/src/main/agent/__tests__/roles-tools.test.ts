import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createRoleTools } from '../tools/roles';
import { listAgentRoles } from '../roles-store';
import { resolveActiveRoles } from '../role-turn';
import { buildRoleMentionMarker } from '../../../shared/agent-roles';

let dir: string;
const tools = () => createRoleTools();
const run = async (tool: { execute: (input: any, ctx?: any) => Promise<unknown> }, input: Record<string, unknown> = {}) =>
  JSON.parse(String(await tool.execute(input))) as any;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'canvas-role-tools-'));
  process.env.PULSE_CANVAS_AGENT_ROLES = join(dir, 'roles.json');
});

afterEach(() => {
  delete process.env.PULSE_CANVAS_AGENT_ROLES;
  rmSync(dir, { recursive: true, force: true });
});

describe('chat role tools', () => {
  it('creates a role from chat and lists it', async () => {
    const { chat_role_save, chat_role_list } = tools();

    const saved = await run(chat_role_save, { name: '产品经理', prompt: '你是资深产品经理。' });
    expect(saved.ok).toBe(true);
    expect(saved.role.id).toMatch(/^role-/);
    expect(saved.role.color).toMatch(/^#[0-9a-f]{6}$/);

    const listed = await run(chat_role_list);
    expect(listed).toMatchObject({ ok: true, total: 1 });
    expect(listed.roles[0]).toMatchObject({ name: '产品经理' });
  });

  it('updates by id and keeps the library at one entry', async () => {
    const { chat_role_save, chat_role_list } = tools();
    const created = await run(chat_role_save, { name: '评审员', prompt: '挑毛病。' });

    const updated = await run(chat_role_save, {
      id: created.role.id, name: '首席评审员', prompt: '更狠地挑毛病。', color: '#2383e2',
    });
    expect(updated.ok).toBe(true);
    expect(updated.role).toMatchObject({ id: created.role.id, name: '首席评审员', color: '#2383e2' });
    expect((await run(chat_role_list)).total).toBe(1);
  });

  it('surfaces store validation as ok:false instead of throwing', async () => {
    const { chat_role_save } = tools();
    await run(chat_role_save, { name: 'Reviewer', prompt: 'p' });

    const duplicate = await run(chat_role_save, { name: 'reviewer', prompt: 'q' });
    expect(duplicate.ok).toBe(false);
    expect(duplicate.error).toMatch(/already exists/);

    const missing = await run(chat_role_save, { id: 'role-nope', name: 'X', prompt: 'p' });
    expect(missing.ok).toBe(false);
    expect(missing.error).toMatch(/not found/i);
  });

  it('a tool-created role is immediately @-able (relay resolution closes the loop)', async () => {
    const { chat_role_save } = tools();
    const saved = await run(chat_role_save, { name: '架构师', prompt: '你是务实的架构师。' });

    const stored = (await listAgentRoles()).find(role => role.id === saved.role.id)!;
    const resolved = await resolveActiveRoles(`${buildRoleMentionMarker(stored)} 评估一下`);
    expect(resolved.map(role => role.name)).toEqual(['架构师']);
  });

  it('stays deferred and never exposes a delete tool', () => {
    const set = tools();
    expect(Object.values(set).every(tool => tool.defer_loading)).toBe(true);
    expect(Object.keys(set).sort()).toEqual(['chat_role_list', 'chat_role_save']);
  });
});
