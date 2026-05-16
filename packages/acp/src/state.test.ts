import { describe, expect, it } from 'vitest';
import { buildAcpEnableState } from './state.js';

const CWD = '/repo';

describe('buildAcpEnableState', () => {
  it('preserves sessionId when agent and cwd are unchanged', () => {
    expect(buildAcpEnableState({
      agent: 'codex',
      cwd: CWD,
      sessionId: 'session-1',
    }, 'codex', CWD)).toEqual({
      agent: 'codex',
      cwd: CWD,
      sessionId: 'session-1',
    });
  });

  it('resets sessionId when agent changes', () => {
    expect(buildAcpEnableState({
      agent: 'claude',
      cwd: CWD,
      sessionId: 'session-1',
    }, 'codex', CWD)).toEqual({
      agent: 'codex',
      cwd: CWD,
      sessionId: undefined,
    });
  });

  it('resets sessionId when cwd changes', () => {
    expect(buildAcpEnableState({
      agent: 'codex',
      cwd: '/old-repo',
      sessionId: 'session-1',
    }, 'codex', CWD)).toEqual({
      agent: 'codex',
      cwd: CWD,
      sessionId: undefined,
    });
  });
});
