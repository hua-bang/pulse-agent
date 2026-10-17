import type { AgentContextScheduledTaskRef } from '../../../shared/scheduled';

const promptLabel = (value: string): string => (
  value.replace(/[\r\n]+/g, ' ').replace(/`/g, "'").trim().slice(0, 200)
);

/** Names the scheduled tasks the user asked about, so "this task" resolves. */
export function formatScheduledTaskContextBlock(tasks: AgentContextScheduledTaskRef[] = []): string {
  if (tasks.length === 0) return '';
  return [
    '',
    '## Scheduled Tasks In Context',
    'The user is asking about these scheduled tasks. "This task" and similar words refer to them:',
    ...tasks.map(task => `- **${promptLabel(task.title)}** (task id: \`${promptLabel(task.id)}\`)`),
    '',
    'Use this id with scheduled_task_update when the user asks to change one of them.',
    '',
  ].join('\n');
}
