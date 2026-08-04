import { describe, expect, it } from 'vitest';
import { resolvePiSessionBinding } from './piSession';

describe('resolvePiSessionBinding', () => {
  it('stays out of the way for every other agent', () => {
    for (const agentType of ['claude-code', 'codex', 'unknown']) {
      const binding = resolvePiSessionBinding(agentType, undefined);
      expect(binding.key).toBeUndefined();
      expect(binding.canResume).toBe(false);
      expect(binding.flags(true)).toBe('');
    }
  });

  it('mints a key on first launch but does not claim it is resumable', () => {
    const binding = resolvePiSessionBinding('pi', undefined);
    expect(binding.key).toBeTruthy();
    expect(binding.canResume).toBe(false);
    // The dir is still scoped — that is what makes the NEXT launch resumable.
    expect(binding.flags(false)).toContain(`pulse-canvas/${binding.key}"`);
  });

  it('never emits --continue for a key it just minted', () => {
    // A node carried over from before this binding reaches the restart card
    // with resume requested; continuing here would read an empty directory at
    // best, and there is no older conversation of this node's to find.
    const binding = resolvePiSessionBinding('pi', undefined);
    expect(binding.flags(true)).not.toContain('--continue');
  });

  it('reuses a saved key and continues only when resuming', () => {
    const binding = resolvePiSessionBinding('pi', 'saved-key');
    expect(binding.key).toBe('saved-key');
    expect(binding.canResume).toBe(true);
    expect(binding.flags(true)).toBe(
      ' --session-dir "$HOME/.pi/agent/sessions/pulse-canvas/saved-key" --continue',
    );
    // A deliberate restart keeps the same directory: the fresh conversation
    // lands beside the old one and becomes what --continue resolves to next.
    expect(binding.flags(false)).toBe(
      ' --session-dir "$HOME/.pi/agent/sessions/pulse-canvas/saved-key"',
    );
  });

  it('gives two nodes disjoint directories', () => {
    const first = resolvePiSessionBinding('pi', undefined);
    const second = resolvePiSessionBinding('pi', undefined);
    expect(first.key).not.toBe(second.key);
  });
});
