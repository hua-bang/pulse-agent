import type {
  ScheduledTask,
  ScheduledTaskInput,
  ScheduledTaskPatch,
} from '../../shared/scheduled';

export interface AgentScheduledPort {
  listTasks: () => Promise<ScheduledTask[]>;
  createTask: (input: ScheduledTaskInput) => Promise<ScheduledTask>;
  updateTask: (taskId: string, patch: ScheduledTaskPatch) => Promise<ScheduledTask>;
}

let scheduledPort: AgentScheduledPort | null = null;

export function setAgentScheduledPort(port: AgentScheduledPort): void {
  scheduledPort = port;
}

export function getAgentScheduledPort(): AgentScheduledPort {
  if (!scheduledPort) throw new Error('Scheduled task integration is unavailable.');
  return scheduledPort;
}
