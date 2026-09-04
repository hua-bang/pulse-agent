import { describe, expect, it } from 'vitest';
import { createHash } from 'crypto';
import { formatLeadExecutionPrompt, formatLeaderBriefingPrompt } from './prompts';

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

describe('agent team lead prompts', () => {
  it('builds the planning-only briefing with cwd, schema, CLI, and user message', () => {
    const prompt = formatLeaderBriefingPrompt('Alpha', 'Ship safely', 'Please proceed', '/repo');

    expect(prompt).toContain('You are the Team Leader for "Alpha" in Pulse Canvas.');
    expect(prompt).toContain('Team working directory: /repo');
    expect(prompt).toContain('"integrationVerify"');
    expect(prompt).toContain("pulse-canvas team propose-plan --plan-json '<json>'");
    expect(prompt).toContain('Do not implement the task yourself.');
    expect(prompt.endsWith('User message:\nPlease proceed')).toBe(true);
  });

  it('omits the cwd block when no working directory was resolved', () => {
    expect(formatLeaderBriefingPrompt('Alpha', '', 'Clarify')).not.toContain('Team working directory:');
  });

  it('builds the execution prompt around delegation and one-shot coordination', () => {
    const prompt = formatLeadExecutionPrompt('Alpha', 'Ship safely', 'What remains?');

    expect(prompt).toContain('Human follow-up for "Alpha" in Pulse Canvas.');
    expect(prompt).toContain('pulse-canvas team status');
    expect(prompt).toContain('Do not use Claude/Codex subagents for teammate work');
    expect(prompt).toContain('Handle this follow-up once.');
    expect(prompt.endsWith('Human message:\nWhat remains?')).toBe(true);
  });

  it('keeps the complete prompt protocol byte-stable', () => {
    expect(sha256(formatLeaderBriefingPrompt(
      'Alpha', 'Ship safely', 'Please proceed', '/repo',
    ))).toBe('106065306f860cea24cfef708ccd14d0df00de9902c143b6b838b296f5849f3b');
    expect(sha256(formatLeaderBriefingPrompt(
      'Alpha', '', 'Clarify',
    ))).toBe('a801511287ca427268faccdb3608a35153f579b36db1e02889f64fc25e108906');
    expect(sha256(formatLeadExecutionPrompt(
      'Alpha', 'Ship safely', 'What remains?',
    ))).toBe('2f37112bf917efa74f9decfc34b1280fbebe83f3a8c3006800ea13c0d2e05e03');
  });
});
