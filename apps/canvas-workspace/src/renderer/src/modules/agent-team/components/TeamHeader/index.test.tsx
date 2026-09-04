// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { TeamHeader } from '.';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('TeamHeader', () => {
  it('presents checkpoint progress and delegates the next-round action', async () => {
    const advanceRound = vi.fn();
    const host = document.createElement('div');
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <TeamHeader
          view={{ title: 'Renderer migration', phaseTitle: 'Round 2 Checkpoint', cwd: '/repo/pulse-agent', doneTaskCount: 3, taskCount: 4, activeTaskCount: 0, phase: 'executing', status: 'round_checkpoint', loading: false, readOnly: false, teamAction: null, planAction: null, checkpointRound: 2, canPause: false, canResume: false, canDispatch: false }}
          actions={{ pause: vi.fn(), resume: vi.fn(), dispatch: vi.fn(), deleteTeam: vi.fn(), advanceRound, finalizeCheckpoint: vi.fn() }}
        />,
      );
    });
    expect(host.textContent).toContain('Renderer migration');
    expect(host.textContent).toContain('3/4 tasks');
    expect(host.textContent).toContain('Round 2 complete');
    await act(async () => { [...host.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.includes('Continue to Round 3'))?.click(); });
    expect(advanceRound).toHaveBeenCalledTimes(1);
    await act(async () => { root.unmount(); });
  });
});
