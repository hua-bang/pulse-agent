// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { HumanGateCard } from '.';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('HumanGateCard', () => {
  it('marks placeholder prompts as non-actionable and delegates answers', async () => {
    const onAnswer = vi.fn();
    const host = document.createElement('div');
    const root = createRoot(host);
    const gate = {
      id: 'gate-1', teamId: 'team-1', reason: 'blocked',
      prompt: 'Agent requested human input.', status: 'open' as const,
      createdAt: 1, updatedAt: 1,
    };
    await act(async () => {
      root.render(
        <HumanGateCard
          gate={gate}
          answer="Proceed"
          onAnswerChange={vi.fn()}
          onAnswer={onAnswer}
          onViewTask={vi.fn()}
        />,
      );
    });
    expect(host.querySelector('.agent-team-human-gate--missing-prompt')).toBeTruthy();
    expect(host.textContent).toContain('did not include a concrete question');
    await act(async () => { host.querySelector<HTMLButtonElement>('button:last-child')?.click(); });
    expect(onAnswer).toHaveBeenCalledTimes(1);
    await act(async () => { root.unmount(); });
  });
});
