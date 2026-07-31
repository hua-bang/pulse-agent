import { AgentIcon } from '../AgentNodeBody/AgentIcon';

/** Agent-branded variant kept with the lazy terminal/menu surfaces. */
export const DockAgentTabIcon = ({ agentType }: { agentType: string }) => {
  const brandModifier = agentType === 'claude-code' || agentType === 'codex'
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
