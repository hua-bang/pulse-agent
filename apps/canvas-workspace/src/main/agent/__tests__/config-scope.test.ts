import { describe, expect, it } from 'vitest';
import { homedir } from 'os';
import { join } from 'path';
import {
  parseScopePayload,
  scopeMcpConfigPath,
  scopeRootDir,
  scopeSkillsDir,
} from '../config-scope';
import { skillSlug } from '../skills/config';

const ROOT = join(homedir(), '.pulse-coder', 'canvas');

describe('config-scope path resolution', () => {
  it('resolves global scope to the canvas root', () => {
    const scope = { level: 'global' } as const;
    expect(scopeRootDir(scope)).toBe(ROOT);
    expect(scopeSkillsDir(scope)).toBe(join(ROOT, 'skills'));
    expect(scopeMcpConfigPath(scope)).toBe(join(ROOT, 'mcp.json'));
  });

  it('resolves workspace scope under the workspace id', () => {
    const scope = { level: 'workspace', workspaceId: 'ws-42' } as const;
    expect(scopeRootDir(scope)).toBe(join(ROOT, 'ws-42'));
    expect(scopeSkillsDir(scope)).toBe(join(ROOT, 'ws-42', 'skills'));
    expect(scopeMcpConfigPath(scope)).toBe(join(ROOT, 'ws-42', 'mcp.json'));
  });
});

describe('parseScopePayload', () => {
  it('defaults to global for missing/garbage input', () => {
    expect(parseScopePayload(undefined)).toEqual({ level: 'global' });
    expect(parseScopePayload(null)).toEqual({ level: 'global' });
    expect(parseScopePayload({ level: 'nope' })).toEqual({ level: 'global' });
  });

  it('parses a valid workspace scope and trims the id', () => {
    expect(parseScopePayload({ level: 'workspace', workspaceId: '  ws-1 ' })).toEqual({
      level: 'workspace',
      workspaceId: 'ws-1',
    });
  });

  it('throws on a workspace scope without a usable id', () => {
    expect(() => parseScopePayload({ level: 'workspace' })).toThrow();
    expect(() => parseScopePayload({ level: 'workspace', workspaceId: '   ' })).toThrow();
  });
});

describe('skillSlug', () => {
  it('lowercases and collapses non-alphanumerics to dashes', () => {
    expect(skillSlug('Code Review')).toBe('code-review');
    expect(skillSlug('My Skill!! 123')).toBe('my-skill-123');
    expect(skillSlug('  keep_dots.and-dashes  ')).toBe('keep_dots.and-dashes');
  });

  it('throws when no alphanumeric content remains', () => {
    expect(() => skillSlug('!!!')).toThrow();
    expect(() => skillSlug('   ')).toThrow();
  });
});
