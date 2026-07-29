import { describe, expect, it } from 'vitest';
import {
  buildRoleMentionMarker,
  findRoleNameMentions,
  formatSpeakerLabel,
  labelAssistantContent,
  normalizeAgentRoleSettings,
  parseFirstRoleMention,
  parseRoleMentions,
  sanitizeAgentRoleName,
  stripRoleMentionMarkers,
} from './agent-roles';

describe('role mention markers', () => {
  it('parses the first role marker (single-speaker view of the relay list)', () => {
    const text = '@[role:r1|产品经理] 先评估,@[role:r2|架构师] 你后说';
    expect(parseFirstRoleMention(text)).toEqual({ roleId: 'r1', name: '产品经理' });
  });

  it('parses ALL role markers in order, deduped by id (relay queue)', () => {
    const text = '@[role:r1|产品经理] @[role:r2|架构师] @[role:r1|产品经理] @[role:r3|评审员] 一起评审';
    expect(parseRoleMentions(text)).toEqual([
      { roleId: 'r1', name: '产品经理' },
      { roleId: 'r2', name: '架构师' },
      { roleId: 'r3', name: '评审员' },
    ]);
    expect(parseRoleMentions('no markers')).toEqual([]);
  });

  it('returns null without a marker and falls back to the id for an empty name', () => {
    expect(parseFirstRoleMention('plain @mention text')).toBeNull();
    expect(parseFirstRoleMention('@[role:r9|] hi')).toEqual({ roleId: 'r9', name: 'r9' });
  });

  it('round-trips through buildRoleMentionMarker', () => {
    const marker = buildRoleMentionMarker({ id: 'role-abc', name: '评审员' });
    expect(marker).toBe('@[role:role-abc|评审员]');
    expect(parseFirstRoleMention(`${marker} 请评审`)).toEqual({ roleId: 'role-abc', name: '评审员' });
  });

  it('strips markers into plain @name addresses for the model', () => {
    expect(stripRoleMentionMarkers('@[role:r1|产品经理] 评估下 @[role:r2|架构师] 的看法')).toBe(
      '@产品经理 评估下 @架构师 的看法',
    );
    expect(stripRoleMentionMarkers('no markers')).toBe('no markers');
  });
});

describe('speaker labels', () => {
  it('prefixes the speaker label onto assistant content', () => {
    expect(labelAssistantContent('结论如下', '产品经理')).toBe('【产品经理】 结论如下');
    expect(formatSpeakerLabel('架构师')).toBe('【架构师】');
  });

  it('leaves content untouched without a speaker', () => {
    expect(labelAssistantContent('结论如下', undefined)).toBe('结论如下');
    expect(labelAssistantContent('结论如下', '  ')).toBe('结论如下');
  });
});

describe('findRoleNameMentions (agent@agent handoff signal)', () => {
  const names = ['评审', '评审员', '产品经理', 'Reviewer'];

  it('finds plain @Name mentions in first-occurrence order, deduped', () => {
    expect(findRoleNameMentions('先请 @产品经理 评估,再让 @评审员 把关。@产品经理 你先。', names))
      .toEqual(['产品经理', '评审员']);
  });

  it('longest name wins on overlap — "@评审员" never counts for "评审"', () => {
    expect(findRoleNameMentions('请 @评审员 看看', names)).toEqual(['评审员']);
    expect(findRoleNameMentions('请 @评审 看看', names)).toEqual(['评审']);
  });

  it('matches ASCII names case-insensitively but returns the canonical name', () => {
    expect(findRoleNameMentions('cc @reviewer please', names)).toEqual(['Reviewer']);
  });

  it('returns nothing without an @ or without candidates', () => {
    expect(findRoleNameMentions('没有点名任何人', names)).toEqual([]);
    expect(findRoleNameMentions('@产品经理', [])).toEqual([]);
    expect(findRoleNameMentions('邮箱 a@b.com 不是点名', names)).toEqual([]);
  });
});

describe('normalizeAgentRoleSettings', () => {
  it('defaults handoff OFF and only accepts literal true', () => {
    expect(normalizeAgentRoleSettings(undefined)).toEqual({ allowRoleHandoff: false });
    expect(normalizeAgentRoleSettings({})).toEqual({ allowRoleHandoff: false });
    expect(normalizeAgentRoleSettings({ allowRoleHandoff: 'yes' })).toEqual({ allowRoleHandoff: false });
    expect(normalizeAgentRoleSettings({ allowRoleHandoff: true })).toEqual({ allowRoleHandoff: true });
  });
});

describe('sanitizeAgentRoleName', () => {
  it('strips marker syntax characters and trims', () => {
    expect(sanitizeAgentRoleName('  产品[经]理|@\n ')).toBe('产品经理');
  });

  it('caps the length', () => {
    expect(sanitizeAgentRoleName('x'.repeat(50))).toHaveLength(20);
  });
});
