import { mkdir, writeFile, readFile, rm } from 'fs/promises';
import { join } from 'path';
import type { TaskNode } from './types';
import type { NodeState } from './runner';

export interface TaskStatus {
  nodeId: string;
  role: string;
  state: NodeState;
  input?: string;
  deps: string[];
  optional?: boolean;
  durationMs?: number;
  error?: string;
}

export interface TasksManifest {
  runId: string;
  task: string;
  createdAt: number;
  updatedAt: number;
  nodes: TaskStatus[];
}

export interface ArtifactStore {
  write(runId: string, nodeId: string, role: string, content: string): Promise<string>;
  getPath(runId: string, nodeId: string): string;
  getTasksPath(runId: string): string;
  /** Initialize the tasks manifest from the graph */
  initTasks(runId: string, task: string, nodes: TaskNode[]): Promise<string>;
  /** Update a single node's state in the manifest */
  updateTaskState(runId: string, nodeId: string, state: NodeState, extra?: { durationMs?: number; error?: string }): Promise<void>;
  cleanup(runId: string): Promise<void>;
}

export class LocalArtifactStore implements ArtifactStore {
  constructor(private baseDir: string = '.pulse-coder/agent-teams') {}

  getPath(runId: string, nodeId: string): string {
    return join(this.baseDir, runId, `${nodeId}.md`);
  }

  getTasksPath(runId: string): string {
    return join(this.baseDir, runId, 'tasks.json');
  }

  async write(runId: string, nodeId: string, role: string, content: string): Promise<string> {
    const dir = join(this.baseDir, runId);
    await mkdir(dir, { recursive: true });
    const filePath = this.getPath(runId, nodeId);
    await writeFile(filePath, `# [${role}] ${nodeId}\n\n${content}`, 'utf-8');
    return filePath;
  }

  async initTasks(runId: string, task: string, nodes: TaskNode[]): Promise<string> {
    const dir = join(this.baseDir, runId);
    await mkdir(dir, { recursive: true });

    const now = Date.now();
    const manifest: TasksManifest = {
      runId,
      task,
      createdAt: now,
      updatedAt: now,
      nodes: nodes.map(n => ({
        nodeId: n.id,
        role: n.role,
        state: 'pending' as NodeState,
        input: n.input,
        deps: n.deps,
        optional: n.optional,
      })),
    };

    const filePath = this.getTasksPath(runId);
    await writeFile(filePath, JSON.stringify(manifest, null, 2), 'utf-8');
    return filePath;
  }

  async updateTaskState(runId: string, nodeId: string, state: NodeState, extra?: { durationMs?: number; error?: string }): Promise<void> {
    const filePath = this.getTasksPath(runId);
    try {
      const raw = await readFile(filePath, 'utf-8');
      const manifest: TasksManifest = JSON.parse(raw);

      const node = manifest.nodes.find(n => n.nodeId === nodeId);
      if (node) {
        node.state = state;
        if (extra?.durationMs != null) node.durationMs = extra.durationMs;
        if (extra?.error) node.error = extra.error;
      }
      manifest.updatedAt = Date.now();

      await writeFile(filePath, JSON.stringify(manifest, null, 2), 'utf-8');
    } catch {
      // Non-fatal: manifest may not exist yet
    }
  }

  async cleanup(runId: string): Promise<void> {
    const dir = join(this.baseDir, runId);
    await rm(dir, { recursive: true, force: true });
  }
}
