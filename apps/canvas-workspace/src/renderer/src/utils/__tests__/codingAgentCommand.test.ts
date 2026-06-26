import { describe, expect, it } from 'vitest';
import { detectCodingAgent, isCodingAgentCommand } from '../codingAgentCommand';

describe('detectCodingAgent', () => {
  it('identifies bare claude / codex invocations', () => {
    expect(detectCodingAgent('claude')).toBe('claude');
    expect(detectCodingAgent('codex')).toBe('codex');
    expect(detectCodingAgent('  claude --resume ')).toBe('claude');
    expect(detectCodingAgent('codex chat')).toBe('codex');
  });

  it('sees through env prefixes and package runners', () => {
    expect(detectCodingAgent('FOO=bar claude')).toBe('claude');
    expect(detectCodingAgent('env CLAUDE_API_KEY=x claude --print')).toBe('claude');
    expect(detectCodingAgent('npx claude')).toBe('claude');
    expect(detectCodingAgent('pnpm dlx codex')).toBe('codex');
  });

  it('returns null for unrelated commands', () => {
    expect(detectCodingAgent('git status')).toBeNull();
    expect(detectCodingAgent('claudette')).toBeNull();
    expect(detectCodingAgent('echo claude')).toBeNull();
    expect(detectCodingAgent('')).toBeNull();
  });

  it('keeps isCodingAgentCommand in sync', () => {
    expect(isCodingAgentCommand('claude')).toBe(true);
    expect(isCodingAgentCommand('codex run')).toBe(true);
    expect(isCodingAgentCommand('ls -la')).toBe(false);
  });
});
