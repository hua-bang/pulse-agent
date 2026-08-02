import { afterEach, describe, expect, it } from 'vitest';

import type { AgentRoleDefinition } from '../../../shared/agent-roles';
import {
  engineTurnBackend,
  externalCliTurnBackend,
  piNativeTurnBackend,
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

afterEach(() => {
  delete process.env.PULSE_CANVAS_PI_NATIVE_CHAT;
});

describe('resolveTurnBackend', () => {
  it('routes the default assistant (null role) to the engine backend', () => {
    process.env.PULSE_CANVAS_PI_NATIVE_CHAT = '0';
    expect(resolveTurnBackend(null)).toBe(engineTurnBackend);
  });

  it('routes persona roles to the engine backend', () => {
    expect(resolveTurnBackend(personaRole)).toBe(engineTurnBackend);
  });

  it('routes externally-driven roles to the external CLI backend', () => {
    expect(resolveTurnBackend(externalRole)).toBe(externalCliTurnBackend);
  });

  it('diverts ONLY the default assistant to pi when the A/B instrument is on', () => {
    process.env.PULSE_CANVAS_PI_NATIVE_CHAT = '1';
    expect(resolveTurnBackend(null)).toBe(piNativeTurnBackend);
    expect(resolveTurnBackend(personaRole)).toBe(engineTurnBackend);
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

  it('declares the pi native backend honestly: no canvas tools yet, CLI sessions', () => {
    expect(piNativeTurnBackend.capabilities).toEqual({
      nativeCanvasTools: false,
      clarifications: 'approval',
      historyFidelity: 'window',
      sessionResume: 'cli',
    });
  });
});
