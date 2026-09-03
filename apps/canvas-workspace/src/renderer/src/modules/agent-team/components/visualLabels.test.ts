import { describe, expect, it } from 'vitest';
import { agentSessionHealthSuffix, agentTeamStatusLabel } from './visualLabels';

describe('Agent Team visual labels', () => {
  it('normalizes task status and PTY health copy', () => {
    expect(agentTeamStatusLabel('in_progress')).toBe('Running');
    expect(agentTeamStatusLabel('custom_state')).toBe('custom state');
    expect(agentSessionHealthSuffix('missing')).toBe(' · offline');
    expect(agentSessionHealthSuffix('queued')).toBe(' · queued');
  });
});
