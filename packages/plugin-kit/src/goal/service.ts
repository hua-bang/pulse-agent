import { promises as fs } from 'fs';
import path from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';

import type {
  CompleteGoalInput,
  Goal,
  GoalSnapshot,
  SetGoalInput,
} from './types.js';

interface GoalStoreFile {
  goal?: Goal;
  createdAt: number;
  updatedAt: number;
}

export interface FileGoalServiceOptions {
  /** Storage directory; defaults to ~/.pulse-coder/goals. */
  baseDir?: string;
  /** File scope (e.g. session id). Defaults to 'default'. */
  scope?: string;
}

/**
 * File-backed goal store. One JSON file per scope keeps the active goal
 * durable across CLI restarts, so a resumed session can pick up where the
 * goal left off. A scope has at most one goal at a time — setting a new goal
 * replaces the current one when it is complete/cleared, and errors while the
 * current goal is still active (hosts should clear first).
 */
export class FileGoalPluginService {
  scope: string;
  storagePath: string;

  private readonly storageDir: string;
  private initialized = false;
  private goal?: Goal;

  constructor(options: FileGoalServiceOptions = {}) {
    this.storageDir = options.baseDir
      ?? process.env.PULSE_CODER_GOALS_DIR
      ?? path.join(homedir(), '.pulse-coder', 'goals');
    this.scope = normalizeScope(options.scope ?? process.env.PULSE_CODER_GOAL_SCOPE ?? 'default');
    this.storagePath = path.join(this.storageDir, `${this.scope}.json`);
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    await this.loadScope(this.scope);
    this.initialized = true;
  }

  /**
   * Switches the service to a different scope (e.g. a newly created/resumed
   * session) and reloads that scope's goal. The same service instance stays
   * bound to plugins registered against it — only the backing file changes.
   */
  async setScope(scope: string): Promise<{ switched: boolean; scope: string; storagePath: string }> {
    await this.initialize();

    const normalized = normalizeScope(scope);
    if (normalized === this.scope) {
      return { switched: false, scope: this.scope, storagePath: this.storagePath };
    }

    await this.loadScope(normalized);

    return { switched: true, scope: this.scope, storagePath: this.storagePath };
  }

  private async loadScope(scope: string): Promise<void> {
    this.scope = scope;
    this.storagePath = path.join(this.storageDir, `${scope}.json`);

    await fs.mkdir(this.storageDir, { recursive: true });

    try {
      const raw = await fs.readFile(this.storagePath, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<GoalStoreFile>;
      this.goal = parsed.goal && typeof parsed.goal === 'object' ? parsed.goal as Goal : undefined;
    } catch (error: any) {
      if (error?.code !== 'ENOENT') {
        throw error;
      }
      this.goal = undefined;
    }
  }

  /** Sets a new active goal. Replaces any existing goal regardless of state. */
  async setGoal(input: SetGoalInput): Promise<Goal> {
    await this.initialize();

    const timestamp = Date.now();
    const next: Goal = {
      id: randomUUID(),
      objective: input.objective.trim(),
      status: 'active',
      verifyCommand: input.verifyCommand?.trim() || undefined,
      maxRounds: input.maxRounds && input.maxRounds > 0 ? Math.floor(input.maxRounds) : undefined,
      roundsUsed: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    this.goal = next;
    await this.persist();

    return next;
  }

  async getGoal(): Promise<Goal | null> {
    await this.initialize();
    return this.goal ?? null;
  }

  /** Removes the active goal entirely (user asked to stop early). */
  async clearGoal(): Promise<boolean> {
    await this.initialize();

    if (!this.goal) {
      return false;
    }

    this.goal = undefined;
    await this.persist();
    return true;
  }

  /** Marks the goal completed with a summary; keeps it on disk for the host. */
  async completeGoal(input: CompleteGoalInput): Promise<Goal | null> {
    await this.initialize();

    if (!this.goal || this.goal.status !== 'active') {
      return this.goal ?? null;
    }

    const timestamp = Date.now();
    this.goal = {
      ...this.goal,
      status: 'completed',
      completedAt: timestamp,
      completedSummary: input.summary.trim(),
      lastProgress: input.evidence?.length
        ? `${input.summary.trim()}\nEvidence:\n${input.evidence.map((item) => `- ${item}`).join('\n')}`
        : input.summary.trim(),
      updatedAt: timestamp,
    };

    await this.persist();
    return this.goal;
  }

  /** Increments the continuation-round counter (host calls before each auto-run). */
  async recordRound(): Promise<Goal | null> {
    await this.initialize();

    if (!this.goal || this.goal.status !== 'active') {
      return this.goal ?? null;
    }

    this.goal = {
      ...this.goal,
      roundsUsed: this.goal.roundsUsed + 1,
      updatedAt: Date.now(),
    };

    await this.persist();
    return this.goal;
  }

  /** Stores a human-readable progress snapshot for the next run's prompt. */
  async setProgress(progress: string): Promise<Goal | null> {
    await this.initialize();

    if (!this.goal || this.goal.status !== 'active') {
      return this.goal ?? null;
    }

    this.goal = {
      ...this.goal,
      lastProgress: progress.trim() || undefined,
      updatedAt: Date.now(),
    };

    await this.persist();
    return this.goal;
  }

  async snapshot(): Promise<GoalSnapshot> {
    await this.initialize();

    if (!this.goal) {
      return {
        status: 'none',
        roundsUsed: 0,
        storagePath: this.storagePath,
      };
    }

    return {
      goalId: this.goal.id,
      status: this.goal.status,
      objective: this.goal.objective,
      verifyCommand: this.goal.verifyCommand,
      maxRounds: this.goal.maxRounds,
      roundsUsed: this.goal.roundsUsed,
      completedAt: this.goal.completedAt,
      completedSummary: this.goal.completedSummary,
      lastProgress: this.goal.lastProgress,
      storagePath: this.storagePath,
    };
  }

  private async persist(): Promise<void> {
    const payload: GoalStoreFile = {
      goal: this.goal,
      createdAt: this.goal?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
    };

    await fs.writeFile(this.storagePath, JSON.stringify(payload, null, 2), 'utf-8');
  }
}

function normalizeScope(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return 'default';
  }
  // Dots are excluded on purpose: a scope is a file name, and ".." would be a
  // path-traversal hazard when joined with the storage directory.
  return trimmed.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 120) || 'default';
}
