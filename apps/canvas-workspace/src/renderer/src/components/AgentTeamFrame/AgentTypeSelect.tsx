import { AgentIcon } from '../AgentNodeBody/AgentIcon';
import type { AgentDef } from '../../config/agentRegistry';
import { Select } from '../ui';

interface AgentTypeSelectProps {
  value: string;
  options: AgentDef[];
  ariaLabel?: string;
  disabled?: boolean;
  onChange: (id: string) => void;
}

/**
 * Coding-agent picker used in the Agent Team plan review. Thin adapter over
 * ui/Select: maps each AgentDef to an option carrying its brand mark
 * (`AgentIcon`) and opens the menu upward (agent cards sit at the bottom of
 * the frame, whose root clips overflow, so the room is above). Stops click /
 * keydown propagation so interacting with it never selects the surrounding
 * agent card.
 */
export const AgentTypeSelect = ({ value, options, ariaLabel, disabled, onChange }: AgentTypeSelectProps) => (
  <div
    className="agent-type-select"
    onClick={(event) => event.stopPropagation()}
    onKeyDown={(event) => event.stopPropagation()}
  >
    <Select
      value={value}
      options={options.map((opt) => ({
        value: opt.id,
        label: opt.label,
        description: opt.description,
        icon: <AgentIcon id={opt.id} size={14} />,
      }))}
      ariaLabel={ariaLabel}
      disabled={disabled}
      onChange={onChange}
      menuPlacement="top"
    />
  </div>
);
