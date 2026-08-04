import { describe, expect, it } from 'vitest';

import type { AgentRoleDefinition } from '../../../shared/agent-roles';
import type { TurnSegmentRequest } from './types';
import {
  engineTurnBackend,
  externalCliTurnBackend,
  piAgentHarnessTurnBackend,
  resolveAgentRuntime,
  resolveTurnBackend,
} from './index';

const personaRole: AgentRoleDefinition = {
  id: 'persona',
  name: 'Persona',
  color: '#2383e2',
  prompt: 'Speak as the persona.',
  createdAt: 0,
  updatedAt: 0,
};

const externalRole: AgentRoleDefinition = {
  ...personaRole,
  id: 'external',
  name: 'External',
  prompt: '',
  external: { family: 'claude-code' },
};

describe('resolveAgentRuntime', () => {
  it('routes the default assistant (null role) to the engine backend', () => {
    expect(resolveAgentRuntime(null, { piEnabled: false })).toBe(engineTurnBackend);
  });

  it('routes persona roles to the engine backend', () => {
    expect(resolveTurnBackend(personaRole)).toBe(engineTurnBackend);
  });

  it('routes externally-driven roles to the external CLI backend', () => {
    expect(resolveTurnBackend(externalRole)).toBe(externalCliTurnBackend);
  });

  it('routes the default assistant to AgentHarness when explicitly enabled', () => {
    expect(resolveAgentRuntime(null, { piEnabled: true })).toBe(piAgentHarnessTurnBackend);
    expect(resolveAgentRuntime(personaRole, { piEnabled: true })).toBe(engineTurnBackend);
    expect(resolveTurnBackend(null, { piEnabled: true })).toBe(piAgentHarnessTurnBackend);
  });

  it('loads the Pi implementation on the first Pi segment', async () => {
    await expect(piAgentHarnessTurnBackend.runSegment({
      abortSignal: AbortSignal.abort(),
    } as TurnSegmentRequest)).rejects.toThrow('Pi AgentHarness run aborted');
  });
});

describe('backend capability matrices', () => {
  it('declares the engine backend as the full-fidelity native backend', () => {
    expect(engineTurnBackend.capabilities).toEqual({
      nativeCanvasTools: true,
      clarifications: 'native',
      historyFidelity: 'full',
      sessionResume: 'host',
      steering: 'none',
      compaction: 'native',
    });
  });

  it('declares the external CLI backend as window-fidelity with CLI-owned sessions', () => {
    expect(externalCliTurnBackend.capabilities).toEqual({
      nativeCanvasTools: false,
      clarifications: 'approval',
      historyFidelity: 'window',
      sessionResume: 'cli',
      steering: 'none',
      compaction: 'cli',
    });
  });

  it('declares pi as a native Canvas runtime with host-owned history and compaction', () => {
    expect(piAgentHarnessTurnBackend.capabilities).toEqual({
      nativeCanvasTools: true,
      clarifications: 'native',
      historyFidelity: 'full',
      sessionResume: 'host',
      steering: 'native',
      compaction: 'host',
    });
  });
});
