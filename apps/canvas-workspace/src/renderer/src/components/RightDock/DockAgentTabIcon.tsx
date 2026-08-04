import { AgentIcon } from '../AgentNodeBody/AgentIcon';

/** Agent ids that own a brand color in `index.css`; others fall back to the neutral slot. */
const BRANDED_AGENT_TYPES = ['claude-code', 'codex', 'pi'];

/** Agent-branded variant kept with the lazy terminal/menu surfaces. */
export const DockAgentTabIcon = ({ agentType }: { agentType: string }) => {
  const brandModifier = BRANDED_AGENT_TYPES.includes(agentType)
    ? ` right-dock__tab-icon--agent-${agentType}`
    : '';

  return (
    <span
      className={`right-dock__tab-icon right-dock__tab-icon--terminal right-dock__tab-icon--agent${brandModifier}`}
      aria-hidden="true"
    >
      <AgentIcon id={agentType} size={14} />
    </span>
  );
};
