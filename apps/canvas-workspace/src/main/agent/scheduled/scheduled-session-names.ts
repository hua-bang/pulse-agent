/**
 * Display names for scheduled-task session stores, so their conversations
 * read as the task the user named rather than a sentinel store id.
 *
 * Scheduled owns execution and injects this read interface at the app root.
 */
import { getAgentScheduledPort } from './scheduled-port';

export async function scheduledTaskTitles(): Promise<Map<string, string>> {
  try {
    const tasks = await getAgentScheduledPort().listTasks();
    return new Map(tasks.map((task) => [task.id, task.title]));
  } catch {
    return new Map();
  }
}
