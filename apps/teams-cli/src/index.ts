import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { Team } from 'pulse-coder-agent-teams';
import type { TeamConfig, TeammateOptions, CreateTaskInput } from 'pulse-coder-agent-teams';
import { InProcessDisplay } from './display/in-process.js';

// ─── Logger ────────────────────────────────────────────────────────

const logger = {
  debug(msg: string) { /* silent by default */ },
  info(msg: string) { console.log(`[info] ${msg}`); },
  warn(msg: string) { console.warn(`[warn] ${msg}`); },
  error(msg: string, err?: Error) { console.error(`[error] ${msg}`, err?.message || ''); },
};

// ─── CLI ───────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === '--help' || command === '-h') {
    printUsage();
    return;
  }

  switch (command) {
    case 'run':
      await runTeam(args.slice(1));
      break;
    case 'interactive':
      await interactiveMode();
      break;
    default:
      // Treat the entire args as a task description
      await runTeam(args);
      break;
  }
}

/**
 * Run a team with auto-configured teammates based on the task.
 *
 * Usage: pulse-teams run "Review PR #142 from security, performance, and test coverage angles"
 */
async function runTeam(args: string[]) {
  const taskDescription = args.join(' ');
  if (!taskDescription) {
    console.error('Error: Please provide a task description.');
    console.error('Usage: pulse-teams run "Your task description"');
    process.exit(1);
  }

  const teamName = `team-${Date.now()}`;
  const team = new Team({ name: teamName, logger });
  const display = new InProcessDisplay(team);
  display.start();

  try {
    // Parse teammate hints from the task description or use defaults
    const teammates = parseTeammateHints(taskDescription);

    console.log(`\nSpawning ${teammates.length} teammates...\n`);

    // Spawn teammates
    await team.spawnTeammates(teammates);

    // Create a single top-level task that the lead would normally break down
    // In a full implementation, the lead Engine would analyze and create sub-tasks
    await team.createTasks([{
      title: 'Complete assigned task',
      description: taskDescription,
    }]);

    // Run the team
    const { stats } = await team.run();

    console.log(`\nTeam run finished. ${stats.completed}/${stats.total} tasks completed.`);

    // Cleanup
    await team.cleanup();
  } catch (err: any) {
    console.error(`\nTeam run failed: ${err.message}`);
    try { await team.cleanup(); } catch { /* best effort */ }
    process.exit(1);
  } finally {
    display.stop();
  }
}

/**
 * Interactive mode: create a team and manage it via REPL.
 */
async function interactiveMode() {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'teams> ',
  });

  let team: Team | null = null;
  let display: InProcessDisplay | null = null;

  console.log('Pulse Agent Teams — Interactive Mode');
  console.log('Type "help" for available commands.\n');

  rl.prompt();

  rl.on('line', async (line) => {
    const parts = line.trim().split(/\s+/);
    const cmd = parts[0];
    const rest = parts.slice(1).join(' ');

    try {
      switch (cmd) {
        case 'create': {
          const name = rest || `team-${Date.now()}`;
          team = new Team({ name, logger });
          display = new InProcessDisplay(team);
          display.start();
          console.log(`Team "${name}" created.`);
          break;
        }

        case 'spawn': {
          if (!team) { console.log('Create a team first: create <name>'); break; }
          const name = rest || `teammate-${team.members.length + 1}`;
          const id = randomUUID().slice(0, 8);
          await team.spawnTeammate({ id, name, logger });
          console.log(`Spawned teammate: ${name} (${id})`);
          break;
        }

        case 'task': {
          if (!team) { console.log('Create a team first.'); break; }
          await team.createTasks([{ title: rest, description: rest }]);
          console.log(`Task created: ${rest}`);
          break;
        }

        case 'run': {
          if (!team) { console.log('Create a team first.'); break; }
          console.log('Running team...');
          const { stats } = await team.run();
          console.log(`Done. ${stats.completed}/${stats.total} completed, ${stats.failed} failed.`);
          break;
        }

        case 'status': {
          if (!team) { console.log('No active team.'); break; }
          console.log(`Team: ${team.name} (${team.status})`);
          console.log(`Members: ${team.members.length}`);
          for (const m of team.members) {
            console.log(`  - ${m.name} (${m.id}) [${m.status}]`);
          }
          const stats = team.getTaskList().stats();
          console.log(`Tasks: ${stats.total} total, ${stats.completed} done, ${stats.in_progress} active, ${stats.pending} pending`);
          break;
        }

        case 'tasks': {
          if (!team) { console.log('No active team.'); break; }
          const tasks = team.getTaskList().getAll();
          if (tasks.length === 0) { console.log('No tasks.'); break; }
          for (const t of tasks) {
            console.log(`  [${t.status}] ${t.title} (${t.id.slice(0, 8)}) → ${t.assignee || 'unassigned'}`);
          }
          break;
        }

        case 'message': {
          if (!team) { console.log('No active team.'); break; }
          const [toId, ...msgParts] = rest.split(' ');
          const mate = team.getTeammate(toId);
          if (!mate) { console.log(`Teammate '${toId}' not found.`); break; }
          mate.sendMessage(toId, msgParts.join(' '));
          console.log(`Message sent to ${toId}.`);
          break;
        }

        case 'cleanup': {
          if (!team) { console.log('No active team.'); break; }
          await team.cleanup();
          display?.stop();
          team = null;
          display = null;
          console.log('Team cleaned up.');
          break;
        }

        case 'help':
          printInteractiveHelp();
          break;

        case 'exit':
        case 'quit':
          if (team) {
            try { await team.cleanup(); } catch { /* best effort */ }
          }
          display?.stop();
          rl.close();
          return;

        default:
          if (cmd) console.log(`Unknown command: ${cmd}. Type "help" for available commands.`);
          break;
      }
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
    }

    rl.prompt();
  });

  rl.on('close', () => {
    process.exit(0);
  });
}

// ─── Helpers ───────────────────────────────────────────────────────

/**
 * Parse teammate configuration hints from the task description.
 * Falls back to a default 3-teammate setup.
 */
function parseTeammateHints(task: string): TeammateOptions[] {
  const lower = task.toLowerCase();
  const teammates: TeammateOptions[] = [];

  // Try to detect role hints
  const roleKeywords: Record<string, string[]> = {
    'security-reviewer': ['security', 'vulnerability', 'auth'],
    'performance-reviewer': ['performance', 'speed', 'optimize', 'latency'],
    'test-reviewer': ['test', 'coverage', 'spec'],
    'researcher': ['research', 'investigate', 'explore', 'analyze'],
    'implementer': ['implement', 'build', 'create', 'develop', 'write'],
    'architect': ['architecture', 'design', 'refactor', 'structure'],
    'debugger': ['debug', 'bug', 'fix', 'error', 'issue'],
  };

  for (const [role, keywords] of Object.entries(roleKeywords)) {
    if (keywords.some(kw => lower.includes(kw))) {
      teammates.push({
        id: randomUUID().slice(0, 8),
        name: role,
        spawnPrompt: `You are a ${role}. Focus on ${keywords.join(', ')} aspects of the task.`,
        logger,
      });
    }
  }

  // If no specific roles detected, use a default team
  if (teammates.length === 0) {
    teammates.push(
      {
        id: randomUUID().slice(0, 8),
        name: 'researcher',
        spawnPrompt: 'You are a researcher. Investigate the problem space, gather context, and report findings.',
        logger,
      },
      {
        id: randomUUID().slice(0, 8),
        name: 'implementer',
        spawnPrompt: 'You are an implementer. Write code and implement solutions based on the task requirements.',
        logger,
      },
      {
        id: randomUUID().slice(0, 8),
        name: 'reviewer',
        spawnPrompt: 'You are a reviewer. Review work done by other teammates for correctness, quality, and completeness.',
        logger,
      },
    );
  }

  return teammates;
}

function printUsage(): void {
  console.log(`
Pulse Agent Teams CLI

Usage:
  pulse-teams run "<task>"     Run a team with auto-configured teammates
  pulse-teams interactive      Start interactive team management REPL
  pulse-teams "<task>"         Shorthand for 'run'
  pulse-teams --help           Show this help

Examples:
  pulse-teams run "Review PR #142 from security, performance, and test angles"
  pulse-teams "Investigate the login timeout bug from different angles"
  pulse-teams interactive
`);
}

function printInteractiveHelp(): void {
  console.log(`
Commands:
  create [name]              Create a new team
  spawn [name]               Spawn a teammate
  task <description>         Create a task
  run                        Run the team (execute all tasks)
  status                     Show team status
  tasks                      List all tasks
  message <id> <text>        Send a message to a teammate
  cleanup                    Clean up the team
  help                       Show this help
  exit                       Exit
`);
}

// ─── Entry ─────────────────────────────────────────────────────────

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
