import { describe, expect, it } from 'vitest';
import {
  appendTerminalOutputTail,
  detectCodingAgentCommand,
  hasLikelyReturnedToShellPrompt,
  isCodingAgentCommand,
} from '../codingAgentCommand';

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

  it('detects common shell prompts after a coding agent exits', () => {
    expect(hasLikelyReturnedToShellPrompt('Done\nroot@devbox:/repo# ')).toBe(true);
    expect(hasLikelyReturnedToShellPrompt('Bye\njasper@macbook:~/pulse-coder$ ')).toBe(true);
    expect(hasLikelyReturnedToShellPrompt('Bye\n(venv) jasper@macbook:~/pulse-coder$ ')).toBe(true);
    expect(hasLikelyReturnedToShellPrompt('Bye\n[alice@workstation pulse-coder]$ ')).toBe(true);
  });

  it('strips terminal control sequences before checking returned prompts', () => {
    const tail = appendTerminalOutputTail('', '\u001b]0;root@devbox:/repo\u0007\r\n\u001b[32mroot@devbox\u001b[0m:/repo# ');
    expect(hasLikelyReturnedToShellPrompt(tail)).toBe(true);
  });
});
