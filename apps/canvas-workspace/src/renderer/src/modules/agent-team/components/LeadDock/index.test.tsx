// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { LeadDock } from '.';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('LeadDock', () => {
  it('shows lead context and the command slot before a runtime node exists', async () => {
    const host = document.createElement('div');
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <LeadDock
          lead={{ id: 'lead-1', teamId: 'team-1', name: 'Team Lead', role: 'lead', status: 'idle', createdAt: 1, updatedAt: 1, sessionRef: { sessionId: 'session-1', provider: 'codex', displayName: 'Codex' } }}
          phase="plan_review"
          teamStatus="waiting_approval"
          selectedTaskTitle="Review module graph"
          commandSlot={<button type="button">Revise plan</button>}
          terminal={{ onUpdate: () => undefined }}
        />,
      );
    });
    expect(host.textContent).toContain('Review module graph');
    expect(host.textContent).toContain('Review the graph and send feedback');
    expect(host.textContent).toContain('Codex');
    expect(host.textContent).toContain('Revise plan');
    await act(async () => { root.unmount(); });
  });
});
