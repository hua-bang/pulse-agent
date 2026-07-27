import { describe, expect, it } from 'vitest';
import {
  buildRoleMentionMarker,
  formatSpeakerLabel,
  labelAssistantContent,
  parseFirstRoleMention,
  sanitizeAgentRoleName,
  stripRoleMentionMarkers,
} from './agent-roles';

describe('role mention markers', () => {
  it('parses the first role marker and ignores later ones (one speaker per turn)', () => {
    const text = '@[role:r1|产品经理] 先评估,@[role:r2|架构师] 你后说';
    expect(parseFirstRoleMention(text)).toEqual({ roleId: 'r1', name: '产品经理' });
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

describe('sanitizeAgentRoleName', () => {
  it('strips marker syntax characters and trims', () => {
    expect(sanitizeAgentRoleName('  产品[经]理|@\n ')).toBe('产品经理');
  });

  it('caps the length', () => {
    expect(sanitizeAgentRoleName('x'.repeat(50))).toHaveLength(20);
  });
});
