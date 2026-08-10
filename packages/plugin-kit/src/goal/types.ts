export type GoalStatus = 'active' | 'completed' | 'cleared';

export interface Goal {
  id: string;
  objective: string;
  status: GoalStatus;
  /** Optional shell command the host can run to verify completion objectively. */
  verifyCommand?: string;
  /** Maximum automatic continuation rounds (host-level guard). */
  maxRounds?: number;
  /** How many continuation rounds the host has run for this goal. */
  roundsUsed: number;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  completedSummary?: string;
  /** Human-readable progress snapshot written at the end of each run. */
  lastProgress?: string;
}

export interface GoalSnapshot {
  goalId?: string;
  status: GoalStatus | 'none';
  objective?: string;
  verifyCommand?: string;
  maxRounds?: number;
  roundsUsed: number;
  completedAt?: number;
  completedSummary?: string;
  lastProgress?: string;
  storagePath: string;
}

export interface SetGoalInput {
  objective: string;
  verifyCommand?: string;
  maxRounds?: number;
}

export interface CompleteGoalInput {
  summary: string;
  evidence?: string[];
}
