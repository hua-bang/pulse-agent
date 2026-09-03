// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { TeamCommand } from '.';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('TeamCommand', () => {
  it('submits a briefing once and clears the draft after success', async () => {
    const briefLead = vi.fn().mockResolvedValue(true);
    const host = document.createElement('div');
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <TeamCommand
          placement="lead"
          phase="briefing"
          teamStatus="planning"
          briefLead={briefLead}
          sendInput={vi.fn()}
        />,
      );
    });
    const textarea = host.querySelector('textarea')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(textarea, 'Ship the migration');
      textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    });
    await act(async () => {
      host.querySelector<HTMLButtonElement>('button:last-child')?.click();
      await Promise.resolve();
    });
    expect(briefLead).toHaveBeenCalledWith('Ship the migration');
    expect(textarea.value).toBe('');
    await act(async () => { root.unmount(); });
  });
});
