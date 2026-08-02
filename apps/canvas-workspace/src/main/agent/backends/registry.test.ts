import { describe, expect, it } from 'vitest';

import type { AgentRoleDefinition } from '../../../shared/agent-roles';
import { engineTurnBackend, externalCliTurnBackend, resolveTurnBackend } from './index';

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

describe('resolveTurnBackend', () => {
  it('routes the default assistant (null role) to the engine backend', () => {
    expect(resolveTurnBackend(null)).toBe(engineTurnBackend);
  });

  it('routes persona roles to the engine backend', () => {
    expect(resolveTurnBackend(personaRole)).toBe(engineTurnBackend);
  });

  it('routes externally-driven roles to the external CLI backend', () => {
    expect(resolveTurnBackend(externalRole)).toBe(externalCliTurnBackend);
  });
});

describe('backend capability matrices', () => {
  it('declares the engine backend as the full-fidelity native backend', () => {
    expect(engineTurnBackend.capabilities).toEqual({
      nativeCanvasTools: true,
      clarifications: 'native',
      historyFidelity: 'full',
      sessionResume: 'host',
    });
  });

  it('declares the external CLI backend as window-fidelity with CLI-owned sessions', () => {
    expect(externalCliTurnBackend.capabilities).toEqual({
      nativeCanvasTools: false,
      clarifications: 'approval',
      historyFidelity: 'window',
      sessionResume: 'cli',
    });
  });
});
