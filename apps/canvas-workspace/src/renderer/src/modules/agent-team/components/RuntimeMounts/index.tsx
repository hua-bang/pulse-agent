import './index.css';
import type { CanvasNode } from '../../../../types';
import { AgentNodeBody } from '../../../coding-agent/surface';
import type { AgentTerminalSurface } from '../AgentDetail';

interface Props {
  nodes: CanvasNode[];
  starting: boolean;
  terminal: AgentTerminalSurface;
}

export const RuntimeMounts = ({ nodes, starting, terminal }: Props) => {
  if (nodes.length === 0) return null;
  return (
    <div className="agent-team-runtime-mounts" aria-hidden="true">
      {nodes.map((node) => (
        <div key={node.id} className="agent-team-runtime-mount">
          <AgentNodeBody node={node} {...terminal} forceTeamWarmup={starting} />
        </div>
      ))}
    </div>
  );
};
