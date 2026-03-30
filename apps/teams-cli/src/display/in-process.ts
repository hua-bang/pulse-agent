import type { Team, TeamEvent } from 'pulse-coder-agent-teams';

/**
 * In-process display renderer.
 * Shows team status, task progress, and teammate output in a single terminal.
 */
export class InProcessDisplay {
  private team: Team;
  private activeTeammateIndex = -1; // -1 = lead view
  private unsubscribe?: () => void;
  private showOutput: boolean;
  /** Track which teammates are currently running, for progress indicator. */
  private runningTasks = new Map<string, { taskTitle: string; startTime: number }>();

  constructor(team: Team, options?: { showOutput?: boolean }) {
    this.team = team;
    this.showOutput = options?.showOutput ?? false;
  }

  /**
   * Start rendering team events.
   */
  start(): void {
    this.unsubscribe = this.team.on((event) => this.handleEvent(event));
    this.printHeader();
  }

  /**
   * Stop rendering.
   */
  stop(): void {
    this.unsubscribe?.();
  }

  /**
   * Cycle to the next teammate (Shift+Down equivalent).
   */
  cycleNext(): void {
    const members = this.team.members;
    if (members.length === 0) return;
    this.activeTeammateIndex = (this.activeTeammateIndex + 1) % members.length;
    const member = members[this.activeTeammateIndex];
    this.log(`\n--- Viewing: ${member.name} (${member.id}) [${member.status}] ---\n`);
  }

  /**
   * Toggle output streaming on/off.
   */
  toggleOutput(): void {
    this.showOutput = !this.showOutput;
    this.log(`[display] Output streaming ${this.showOutput ? 'ON' : 'OFF'}`);
  }

  // ─── Internal ────────────────────────────────────────────────────

  private handleEvent(event: TeamEvent): void {
    const ts = new Date(event.timestamp).toLocaleTimeString();

    switch (event.type) {
      case 'teammate:spawned':
        this.log(`[${ts}] [team] Teammate spawned: ${event.data.name} (${event.data.id})`);
        break;

      case 'teammate:stopped':
        this.log(`[${ts}] [team] Teammate stopped: ${event.data.name}`);
        break;

      case 'teammate:idle':
        this.log(`[${ts}] [team] Teammate idle: ${event.data.name} (${event.data.reason})`);
        break;

      case 'teammate:run_start':
        this.runningTasks.set(event.data.id, { taskTitle: event.data.taskTitle, startTime: event.timestamp });
        this.log(`[${ts}] [run]  ${event.data.name} starting: "${event.data.taskTitle}" ...`);
        break;

      case 'teammate:run_end': {
        this.runningTasks.delete(event.data.id);
        const sec = (event.data.durationMs / 1000).toFixed(1);
        this.log(`[${ts}] [run]  ${event.data.name} finished: "${event.data.taskTitle}" (${sec}s)`);
        break;
      }

      case 'teammate:output':
        // Stream LLM text output (can be verbose)
        if (this.showOutput) {
          process.stdout.write(event.data.text);
        }
        break;

      case 'task:created':
        this.log(`[${ts}] [task] Created: ${event.data.task.title}`);
        break;

      case 'task:claimed':
        this.log(`[${ts}] [task] ${event.data.teammateName} claimed: ${event.data.taskTitle}`);
        break;

      case 'task:completed':
        this.log(`[${ts}] [task] \u2713 ${event.data.taskTitle} completed`);
        break;

      case 'task:failed':
        this.log(`[${ts}] [task] \u2717 ${event.data.taskTitle} failed: ${event.data.error}`);
        break;

      case 'team:started':
        this.log(`[${ts}] [team] Team started: ${event.data.name}`);
        break;

      case 'team:completed':
        this.printStats(event.data.stats);
        break;

      case 'team:cleanup':
        this.log(`[${ts}] [team] Cleaned up: ${event.data.name}`);
        break;
    }
  }

  private printHeader(): void {
    this.log('');
    this.log('='.repeat(60));
    this.log(`  Pulse Agent Teams \u2014 ${this.team.name}`);
    this.log('='.repeat(60));
    this.log('');
  }

  private printStats(stats: { total: number; completed: number; failed: number }): void {
    this.log('');
    this.log('--- Team Run Complete ---');
    this.log(`  Total: ${stats.total}  Completed: ${stats.completed}  Failed: ${stats.failed}`);
    this.log('');
  }

  private log(msg: string): void {
    process.stdout.write(msg + '\n');
  }
}
