import type { Team, TeamEvent, TeammateStatus } from 'pulse-coder-agent-teams';

/**
 * In-process display renderer.
 * Shows team status, task progress, and teammate output in a single terminal.
 */
export class InProcessDisplay {
  private team: Team;
  private activeTeammateIndex = -1; // -1 = lead view
  private unsubscribe?: () => void;

  constructor(team: Team) {
    this.team = team;
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
      case 'task:created':
        this.log(`[${ts}] [task] Created: ${event.data.task.title}`);
        break;
      case 'task:claimed':
        this.log(`[${ts}] [task] ${event.data.teammateName} claimed: ${event.data.taskTitle}`);
        break;
      case 'task:completed':
        this.log(`[${ts}] [task] \u2713 ${event.data.taskTitle} completed by ${event.data.teammateId}`);
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
    this.log(`  Pulse Agent Teams — ${this.team.name}`);
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
