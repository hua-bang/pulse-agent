// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentTeamHumanGateRecord, AgentTeamSnapshot } from '../../../types';
import type { ToastInput } from '../../../types/ui-interaction';
import { useTeamInputAlerts } from './useTeamInputAlerts';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type UpdateListener = (event: { workspaceId: string; nodeIds: string[]; source: string }) => void;

let root: Root | null = null;
let listener: UpdateListener | null = null;
const notify = vi.fn<(toast: ToastInput) => void>();
const openWorkspace = vi.fn();
const list = vi.fn();

const gate = (id: string, prompt: string, extra: Partial<AgentTeamHumanGateRecord> = {}): AgentTeamHumanGateRecord => ({
  id,
  teamId: 'team-1',
  reason: 'decision',
  prompt,
  status: 'open',
  createdAt: 1,
  updatedAt: 1,
  ...extra,
});

const snapshot = (humanGates: AgentTeamHumanGateRecord[]) => ({
  workspaceId: 'ws-1',
  runtime: { team: { id: 'team-1', name: 'Launch team' }, humanGates },
}) as unknown as AgentTeamSnapshot;

const Probe = () => {
  useTeamInputAlerts({
    notify,
    openWorkspace,
    labels: { title: (team) => `${team} needs your input`, open: 'Open' },
  });
  return null;
};

const emit = async (source = 'agent-teams') => {
  listener?.({ workspaceId: 'ws-1', nodeIds: ['frame'], source });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500);
  });
};

beforeEach(async () => {
  vi.useFakeTimers();
  (window as unknown as { canvasWorkspace: unknown }).canvasWorkspace = {
    store: {
      onExternalUpdate: (callback: UpdateListener) => {
        listener = callback;
        return () => { listener = null; };
      },
    },
    agentTeams: { list },
  };
  const host = document.createElement('div');
  root = createRoot(host);
  await act(async () => root?.render(<Probe />));
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  vi.useRealTimers();
  delete (window as unknown as { canvasWorkspace?: unknown }).canvasWorkspace;
  notify.mockReset();
  openWorkspace.mockReset();
  list.mockReset();
});

describe('useTeamInputAlerts', () => {
  it('shows one sticky toast per open question and opens the workspace from it', async () => {
    list.mockResolvedValue({ ok: true, teams: [snapshot([gate('g1', 'Which region?')])] });

    await emit();
    await emit();

    expect(list).toHaveBeenCalledWith('ws-1');
    expect(notify).toHaveBeenCalledTimes(1);
    const toast = notify.mock.calls[0]![0];
    expect(toast).toMatchObject({
      title: 'Launch team needs your input',
      description: 'Which region?',
      autoCloseMs: 0,
    });
    toast.action?.onClick();
    expect(openWorkspace).toHaveBeenCalledWith('ws-1');
  });

  it('ignores answered gates, lead-only gates, placeholder prompts, and other sources', async () => {
    list.mockResolvedValue({
      ok: true,
      teams: [snapshot([
        gate('answered', 'Ship it?', { status: 'answered' }),
        gate('lead', 'Ask the lead', { metadata: { audience: 'lead' } }),
        gate('placeholder', 'Agent requested human input.'),
      ])],
    });

    await emit('main');
    expect(list).not.toHaveBeenCalled();

    await emit();
    expect(list).toHaveBeenCalledTimes(1);
    expect(notify).not.toHaveBeenCalled();
  });
});
