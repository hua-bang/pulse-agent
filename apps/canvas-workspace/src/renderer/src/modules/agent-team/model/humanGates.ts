import type { AgentTeamHumanGateRecord } from '../../../types';

export const hasConcreteHumanGatePrompt = (prompt: string): boolean => {
  const normalized = prompt.trim().replace(/\s+/g, ' ');
  if (!normalized) return false;
  if (/^agent requested human input\.?$/i.test(normalized)) return false;
  if (/^human input requested\.?$/i.test(normalized)) return false;
  return true;
};

/** An open question for the user, not one a teammate asked the lead. */
export const isHumanFacingGate = (gate: AgentTeamHumanGateRecord): boolean => (
  gate.metadata?.audience !== 'lead' && hasConcreteHumanGatePrompt(gate.prompt)
);
