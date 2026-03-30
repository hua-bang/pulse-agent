export type TeamRole =
  | 'researcher'
  | 'executor'
  | 'reviewer'
  | 'writer'
  | 'tester'
  | (string & {});

export type TaskNodeStatus = 'success' | 'failed' | 'skipped';

export interface TaskNode {
  id: string;
  role: TeamRole;
  deps: string[];
  input?: string;
  optional?: boolean;
  /** 覆盖该节点使用的 agent 名称（不填则从 roleAgents 映射查找） */
  agent?: string;
  /** node 粒度的 prompt 指令，会前置拼接到 task 中 */
  instruction?: string;
}

export interface TaskGraph {
  nodes: TaskNode[];
}

export interface NodeResult {
  nodeId: string;
  role: TeamRole;
  status: TaskNodeStatus;
  agentName?: string;
  output?: string;
  error?: string;
  attempts: number;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  skippedReason?: string;
}

export type AggregateStrategy = 'concat' | 'last' | 'llm';

/**
 * Lightweight interface for task tracking integration.
 * Orchestrator uses this to sync node states to an external task list,
 * so that sub-agents can query overall progress via task_list tool.
 * Matches the subset of TaskListService API used by the orchestrator.
 */
export interface TaskTracker {
  createTasks(inputs: Array<{
    title: string;
    details?: string;
    status?: string;
    dependencies?: string[];
    metadata?: Record<string, any>;
  }>): Promise<Array<{ id: string }>>;
  updateTask(input: {
    id: string;
    status?: string;
    details?: string;
    metadata?: Record<string, any>;
  }): Promise<any>;
}

export interface OrchestrationInput {
  task: string;
  context?: Record<string, any>;
  /** 明确指定角色列表 */
  roles?: TeamRole[];
  /** 直接传入自定义 TaskGraph（优先级最高） */
  graph?: TaskGraph;
  /** auto=关键词路由, all=全角色, plan=LLM动态规划 */
  route?: 'auto' | 'all' | 'plan';
  includeRoles?: TeamRole[];
  excludeRoles?: TeamRole[];
  /** 角色到 agent 名称的映射，可覆盖默认 registry */
  roleAgents?: Record<string, string>;
  maxConcurrency?: number;
  nodeTimeoutMs?: number;
  retries?: number;
  aggregate?: AggregateStrategy;
}

export interface OrchestrationResult {
  task: string;
  runId: string;
  roles: TeamRole[];
  graph: TaskGraph;
  results: Record<string, NodeResult>;
  aggregate: string;
}
