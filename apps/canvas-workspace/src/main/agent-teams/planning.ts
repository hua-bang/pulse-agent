import { randomUUID } from 'crypto';
import type {
  CanvasAgentTeamPlanDraft,
  CanvasAgentTeamPlanTask,
  CanvasAgentTeamPlanTeammate,
} from './types';
import { cleanString } from './input-normalization';

export const DEFAULT_TEAMMATE_AGENT = 'codex';
const MAX_PLAN_TEAMMATES = 6;
const MAX_PLAN_TASKS = 20;

export interface ResolvedPlanTask {
  id: string;
  task: CanvasAgentTeamPlanTask;
  depIds: string[];
}

const asPlainObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

function normalizePlanTeammates(value: unknown): CanvasAgentTeamPlanTeammate[] {
  const teammates = (Array.isArray(value) ? value : [])
    .map((item): CanvasAgentTeamPlanTeammate | null => {
      if (typeof item === 'string') {
        const name = cleanString(item);
        return name ? { name, agentType: DEFAULT_TEAMMATE_AGENT } : null;
      }
      const object = asPlainObject(item);
      const name = cleanString(object.name);
      if (!name) return null;
      return { name, agentType: cleanString(object.agentType, DEFAULT_TEAMMATE_AGENT) };
    })
    .filter((item): item is CanvasAgentTeamPlanTeammate => !!item);

  if (teammates.length > MAX_PLAN_TEAMMATES) {
    throw new Error(
      `Plan has ${teammates.length} teammates; the maximum is ${MAX_PLAN_TEAMMATES}. `
      + 'Consolidate ownership so each teammate owns a durable area, then resubmit the plan.',
    );
  }
  return teammates.length > 0
    ? teammates
    : [{ name: 'Codex Exec', agentType: DEFAULT_TEAMMATE_AGENT }];
}

function normalizePlanTasks(value: unknown, fallbackSummary: string): CanvasAgentTeamPlanTask[] {
  const tasks = (Array.isArray(value) ? value : [])
    .map((item): CanvasAgentTeamPlanTask | null => {
      const object = asPlainObject(item);
      const title = cleanString(object.title);
      if (!title) return null;
      const scope = Array.isArray(object.scope)
        ? object.scope.map((entry) => cleanString(entry)).filter(Boolean)
        : [];
      return {
        title,
        description: cleanString(object.description, title),
        ownerName: cleanString(object.ownerName) || undefined,
        deps: Array.isArray(object.deps)
          ? object.deps.map((dependency) => cleanString(dependency)).filter(Boolean)
          : [],
        scope: scope.length > 0 ? scope : undefined,
        verify: cleanString(object.verify) || undefined,
      };
    })
    .filter((item): item is CanvasAgentTeamPlanTask => !!item);

  if (tasks.length > MAX_PLAN_TASKS) {
    throw new Error(
      `Plan has ${tasks.length} tasks; the maximum is ${MAX_PLAN_TASKS}. `
      + 'Merge small tasks, or submit a first-round plan now and add later work after the round checkpoint.',
    );
  }
  if (tasks.length > 0) return tasks;
  return [{
    title: 'Execute approved plan',
    description: fallbackSummary || 'Carry out the plan approved by the user.',
    ownerName: 'Codex Exec',
    deps: [],
  }];
}

export function parsePlanDraft(text: string, sourceAgentId: string, now: number): CanvasAgentTeamPlanDraft | null {
  const trimmed = text.trim();
  if (!trimmed || /^<[^>]+>$/.test(trimmed)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  return planDraftFromObject(asPlainObject(parsed), sourceAgentId, now);
}

function planDraftFromObject(
  object: Record<string, unknown>,
  sourceAgentId: string,
  now: number,
): CanvasAgentTeamPlanDraft {
  const summary = cleanString(object.summary, 'Leader proposed a team execution plan.');
  return {
    summary,
    teammates: normalizePlanTeammates(object.teammates),
    tasks: normalizePlanTasks(object.tasks, summary),
    integrationVerify: cleanString(object.integrationVerify) || undefined,
    sourceAgentId,
    createdAt: now,
    updatedAt: now,
  };
}

export function planDraftFromUnknown(
  value: unknown,
  sourceAgentId: string,
  now: number,
): CanvasAgentTeamPlanDraft {
  if (typeof value === 'string') {
    const parsed = parsePlanDraft(value, sourceAgentId, now);
    if (!parsed) throw new Error('Plan must be valid JSON');
    return parsed;
  }
  const object = asPlainObject(value);
  if (Object.keys(object).length === 0) throw new Error('Plan must be a JSON object');
  return planDraftFromObject(object, sourceAgentId, now);
}

const planTaskKey = (title: string): string => title.trim().toLowerCase().replace(/\s+/g, ' ');

export function resolvePlanTaskGraph(tasks: CanvasAgentTeamPlanTask[]): ResolvedPlanTask[] {
  const taskByTitle = new Map<string, { task: CanvasAgentTeamPlanTask; id: string }>();
  for (const task of tasks) {
    const key = planTaskKey(task.title);
    if (taskByTitle.has(key)) throw new Error(`Duplicate task title in plan: ${task.title}`);
    taskByTitle.set(key, { task, id: randomUUID() });
  }

  const resolved = tasks.map((task): ResolvedPlanTask => {
    const current = taskByTitle.get(planTaskKey(task.title));
    if (!current) throw new Error(`Task not found in plan: ${task.title}`);
    const depIds = Array.from(new Set((task.deps ?? []).map((dependencyTitle) => {
      const dependency = taskByTitle.get(planTaskKey(dependencyTitle));
      if (!dependency) {
        throw new Error(`Unknown task dependency "${dependencyTitle}" for task "${task.title}"`);
      }
      return dependency.id;
    })));
    return { id: current.id, task, depIds };
  });

  assertResolvedPlanTaskGraphAcyclic(resolved);
  return resolved;
}

function assertResolvedPlanTaskGraphAcyclic(tasks: ResolvedPlanTask[]): void {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];

  const label = (id: string): string => {
    const task = byId.get(id);
    return task ? `${task.task.title} (${id})` : id;
  };
  const visit = (id: string): string[] | null => {
    if (visiting.has(id)) return [...stack.slice(stack.indexOf(id)), id];
    if (visited.has(id)) return null;
    const task = byId.get(id);
    if (!task) return null;
    visiting.add(id);
    stack.push(id);
    for (const dependencyId of task.depIds) {
      const cycle = visit(dependencyId);
      if (cycle) return cycle;
    }
    stack.pop();
    visiting.delete(id);
    visited.add(id);
    return null;
  };

  for (const task of tasks) {
    const cycle = visit(task.id);
    if (cycle) throw new Error(`Task dependency cycle detected: ${cycle.map(label).join(' -> ')}`);
  }
}
