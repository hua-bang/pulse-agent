/**
 * Display names for scheduled-task session stores, so their conversations
 * read as the task the user named rather than a sentinel store id.
 *
 * `scheduled/runtime` reaches back into the agent service, so it is imported
 * per call — an eager import would close a module cycle.
 */
export async function scheduledTaskTitles(): Promise<Map<string, string>> {
  try {
    const { getScheduledTaskService } = await import('../scheduled/runtime');
    const tasks = await getScheduledTaskService().listTasks();
    return new Map(tasks.map((task) => [task.id, task.title]));
  } catch {
    return new Map();
  }
}
