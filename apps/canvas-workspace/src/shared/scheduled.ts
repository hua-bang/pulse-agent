export const SCHEDULED_MIN_INTERVAL_MINUTES = 30;

export type ScheduledTaskSource = 'user' | 'memory-report';
export type ScheduledTaskRunStatus = 'idle' | 'running';

export interface ScheduledTask {
  id: string;
  title: string;
  prompt: string;
  intervalMinutes: number;
  enabled: boolean;
  source: ScheduledTaskSource;
  createdAt: number;
  updatedAt: number;
  nextRunAt: number;
  lastAttemptAt?: number;
  lastSuccessAt?: number;
  lastError?: string;
  lastSessionId?: string;
  runCount: number;
  status: ScheduledTaskRunStatus;
}

export interface ScheduledTaskInput {
  title: string;
  prompt: string;
  intervalMinutes: number;
  enabled?: boolean;
}

export interface ScheduledTaskPatch {
  title?: string;
  prompt?: string;
  intervalMinutes?: number;
  enabled?: boolean;
}

export interface ScheduledTaskExecutionResult {
  sessionId?: string;
}

export interface ScheduledApi {
  list: () => Promise<{ ok: boolean; tasks?: ScheduledTask[]; error?: string }>;
  create: (
    input: ScheduledTaskInput,
  ) => Promise<{ ok: boolean; task?: ScheduledTask; error?: string }>;
  update: (
    taskId: string,
    patch: ScheduledTaskPatch,
  ) => Promise<{ ok: boolean; task?: ScheduledTask; error?: string }>;
  remove: (taskId: string) => Promise<{ ok: boolean; error?: string }>;
  runNow: (
    taskId: string,
  ) => Promise<{ ok: boolean; task?: ScheduledTask; error?: string }>;
  onChanged: (callback: (tasks: ScheduledTask[]) => void) => () => void;
  onOpenTask: (callback: (taskId: string) => void) => () => void;
}
