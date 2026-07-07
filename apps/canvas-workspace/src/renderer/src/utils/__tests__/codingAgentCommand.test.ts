import { describe, expect, it } from 'vitest';
import { detectCodingAgentCommand, isCodingAgentCommand } from '../codingAgentCommand';

describe('codingAgentCommand', () => {
  it('detects Claude and Codex commands from direct and runner invocations', () => {
    expect(detectCodingAgentCommand('claude')).toBe('claude-code');
    expect(detectCodingAgentCommand('codex --model gpt-5')).toBe('codex');
    expect(detectCodingAgentCommand('env FOO=bar npx -y @anthropic-ai/claude-code')).toBe('claude-code');
    expect(detectCodingAgentCommand('pnpm exec -- @openai/codex resume abc')).toBe('codex');
  });

  it('keeps the boolean helper behavior', () => {
    expect(isCodingAgentCommand('npm exec codex')).toBe(true);
    expect(isCodingAgentCommand('echo codex')).toBe(false);
  });
});
