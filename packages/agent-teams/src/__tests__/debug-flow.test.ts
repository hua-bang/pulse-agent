/**
 * End-to-end flow test: Team + Teammates + TaskList + Mailbox
 * Uses disableBuiltInPlugins so no API keys needed.
 * Run: pnpm --filter pulse-coder-agent-teams test -- -t "debug-flow"
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Team } from '../team.js';
import { TeamLead } from '../team-lead.js';
import { planTeam, buildTeammateOptionsFromPlan } from '../planner.js';
import type { TeamEvent, TeamPlan } from '../types.js';

const log = {
  debug() {},
  info(msg: string) { console.log(`  [info] ${msg}`); },
  warn(msg: string) { console.warn(`  [warn] ${msg}`); },
  error(msg: string) { console.error(`  [error] ${msg}`); },
};

describe('debug-flow', () => {
  let stateDir: string;

  afterEach(() => {
    try { rmSync(stateDir, { recursive: true, force: true }); } catch {}
  });

  it('full manual flow: create team → spawn → tasks → claim → complete → deps unblock', async () => {
    stateDir = mkdtempSync(join(tmpdir(), 'debug-flow-'));
    const events: TeamEvent[] = [];

    // 1. Create team
    const team = new Team({ name: 'debug-team', stateDir, logger: log });
    team.on(e => events.push(e));

    // 2. Spawn teammates
    const alice = await team.spawnTeammate({
      id: 'alice', name: 'researcher', logger: log,
      engineOptions: { disableBuiltInPlugins: true },
    });
    const bob = await team.spawnTeammate({
      id: 'bob', name: 'implementer', logger: log,
      engineOptions: { disableBuiltInPlugins: true },
    });

    expect(team.members).toHaveLength(2);
    console.log('  Spawned:', team.members.map(m => `${m.name}(${m.id})`).join(', '));

    // 3. Create tasks with dependencies
    const taskList = team.getTaskList();
    const t1 = await taskList.create({ title: 'Research API', description: 'Read the docs' }, 'lead');
    const t2 = await taskList.create({ title: 'Implement client', description: 'Build SDK', deps: [t1.id] }, 'lead');
    const t3 = await taskList.create({ title: 'Write tests', description: 'Add test coverage', deps: [t2.id] }, 'lead');

    console.log('  Tasks created:', taskList.getAll().map(t => t.title).join(', '));
    console.log('  Claimable:', taskList.getClaimable().map(t => t.title).join(', '));

    // 4. Only t1 should be claimable (t2/t3 blocked by deps)
    expect(taskList.getClaimable()).toHaveLength(1);
    expect(taskList.getClaimable()[0].title).toBe('Research API');

    // 5. Alice claims t1
    const claimed = await alice.claimTask();
    expect(claimed!.title).toBe('Research API');
    console.log('  Alice claimed:', claimed!.title);

    // Bob can't claim anything yet (t2 blocked)
    const bobClaim = await bob.claimTask();
    expect(bobClaim).toBeNull();
    console.log('  Bob tried to claim: nothing available (deps blocked)');

    // 6. Alice completes t1 → t2 should unblock
    await alice.completeTask(t1.id, 'API docs analyzed, found 5 endpoints');
    console.log('  Alice completed:', t1.title);

    const nowClaimable = taskList.getClaimable();
    expect(nowClaimable).toHaveLength(1);
    expect(nowClaimable[0].title).toBe('Implement client');
    console.log('  Now claimable:', nowClaimable.map(t => t.title).join(', '));

    // 7. Bob claims t2
    const bobTask = await bob.claimTask();
    expect(bobTask!.title).toBe('Implement client');
    await bob.completeTask(t2.id, 'SDK client built with 5 methods');
    console.log('  Bob claimed and completed:', t2.title);

    // 8. t3 should now be claimable
    expect(taskList.getClaimable()).toHaveLength(1);
    expect(taskList.getClaimable()[0].title).toBe('Write tests');

    // 9. Messaging
    alice.sendMessage('bob', 'Nice work on the SDK!');
    const bobMessages = bob.readMessages();
    expect(bobMessages).toHaveLength(1);
    expect(bobMessages[0].content).toBe('Nice work on the SDK!');
    console.log('  Alice → Bob message delivered');

    // 10. Stats
    const stats = taskList.stats();
    console.log(`  Stats: ${stats.completed}/${stats.total} completed, ${stats.pending} pending`);
    expect(stats.completed).toBe(2);
    expect(stats.pending).toBe(1);

    // 11. Events
    console.log(`  Total events emitted: ${events.length}`);
    expect(events.some(e => e.type === 'teammate:spawned')).toBe(true);

    // Cleanup
    await team.shutdownAll();
    await team.cleanup();
  });

  it('plan approval flow: planMode → submit → reject → revise → approve', async () => {
    stateDir = mkdtempSync(join(tmpdir(), 'debug-plan-'));

    const lead = new TeamLead({
      teamName: 'plan-test',
      stateDir,
      logger: log,
      engineOptions: { disableBuiltInPlugins: true },
    });
    await lead.initialize();

    // Spawn teammate with plan approval required
    await lead.team.spawnTeammate({
      id: 'arch-1', name: 'architect',
      requirePlanApproval: true,
      logger: log,
      engineOptions: { disableBuiltInPlugins: true },
    });

    const arch = lead.team.getTeammate('arch-1')!;
    expect(arch.planMode).toBe(true);
    console.log('  Architect spawned in plan mode');

    // Simulate: architect submits plan via mailbox
    arch.sendMessage('lead', 'My plan: refactor auth into 3 modules');
    lead.team.getMailbox().send('arch-1', 'lead', 'plan_approval_request', 'Refactor plan v1');

    // Lead reads and rejects
    const leadMsgs = lead.readMessages();
    console.log(`  Lead received ${leadMsgs.length} messages`);
    expect(leadMsgs.length).toBeGreaterThan(0);

    lead.rejectPlan('arch-1', 'Need test strategy included');
    console.log('  Lead rejected plan');

    const rejection = arch.checkPlanApproval();
    expect(rejection!.approved).toBe(false);
    expect(rejection!.feedback).toBe('Need test strategy included');
    expect(arch.planMode).toBe(true); // still locked
    console.log('  Architect received rejection, still in plan mode');

    // Lead approves revised plan
    lead.approvePlan('arch-1');
    const approval = arch.checkPlanApproval();
    expect(approval!.approved).toBe(true);
    expect(arch.planMode).toBe(false); // unlocked!
    console.log('  Lead approved, architect exited plan mode');

    await lead.team.shutdownAll();
    await lead.team.cleanup();
  });

  it('LLM planner with mock: generates valid plan', async () => {
    const mockPlan: TeamPlan = {
      teammates: [
        { name: 'security-reviewer', role: 'Review for vulnerabilities', spawnPrompt: 'Focus on OWASP top 10' },
        { name: 'perf-reviewer', role: 'Check performance', spawnPrompt: 'Profile hot paths' },
        { name: 'test-reviewer', role: 'Validate test coverage', spawnPrompt: 'Check edge cases' },
      ],
      tasks: [
        { title: 'Scan for SQL injection', description: 'Check all DB queries', assignTo: 'security-reviewer' },
        { title: 'Profile API endpoints', description: 'Measure p99 latency', assignTo: 'perf-reviewer' },
        { title: 'Audit test coverage', description: 'Find untested code paths', assignTo: 'test-reviewer' },
        { title: 'Write summary', description: 'Consolidate all findings', depNames: ['Scan for SQL injection', 'Profile API endpoints', 'Audit test coverage'] },
      ],
    };

    const plan = await planTeam('Review PR #142', {
      llmCall: async () => JSON.stringify(mockPlan),
      logger: log,
    });

    console.log(`  Plan: ${plan.teammates.length} teammates, ${plan.tasks.length} tasks`);
    for (const t of plan.teammates) {
      console.log(`    - ${t.name}: ${t.role}`);
    }
    for (const t of plan.tasks) {
      const deps = t.depNames?.length ? ` (after: ${t.depNames.join(', ')})` : '';
      console.log(`    - [task] ${t.title} → ${t.assignTo || 'unassigned'}${deps}`);
    }

    expect(plan.teammates).toHaveLength(3);
    expect(plan.tasks).toHaveLength(4);
    expect(plan.tasks[3].depNames).toHaveLength(3);

    // Convert to options
    const opts = buildTeammateOptionsFromPlan(plan, { disableBuiltInPlugins: true }, log);
    expect(opts).toHaveLength(3);
    expect(opts[0].spawnPrompt).toBe('Focus on OWASP top 10');
  });
});
