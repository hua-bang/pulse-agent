import { generateTextAI } from 'pulse-coder-engine';
import { Orchestrator, EngineAgentRunner } from 'pulse-coder-orchestrator';
import { TeamLead, InProcessDisplay } from 'pulse-coder-agent-teams';
import type { TeamPlan } from 'pulse-coder-agent-teams';
import type { OrchestrationInput, OrchestratorLogger, TaskGraph, TeamRole } from 'pulse-coder-orchestrator';
import type { PulseAgent } from 'pulse-coder-engine';

const cyan = '\x1b[36m';
const yellow = '\x1b[33m';
const red = '\x1b[31m';
const bold = '\x1b[1m';
const dim = '\x1b[2m';
const reset = '\x1b[0m';

// ─── /team (DAG orchestrator) ─────────────────────────────────────

function createOrchestrator(agent: PulseAgent, activeNodes: Set<string>): Orchestrator {
  const runner = new EngineAgentRunner(() => agent.getTools());

  const llmCall = async (systemPrompt: string, userPrompt: string): Promise<string> => {
    const result = await generateTextAI(
      [{ role: 'user', content: userPrompt }],
      {},
      { systemPrompt },
    );
    return result.text?.trim() ?? '';
  };

  const logger: OrchestratorLogger = {
    debug: () => {},
    info: (msg) => {
      const startMatch = msg.match(/^Starting: (\S+)/);
      if (startMatch) activeNodes.add(startMatch[1]);
      const doneMatch = msg.match(/^Node (\S+)/);
      if (doneMatch) activeNodes.delete(doneMatch[1]);

      console.log(`${cyan}[orchestrator]${reset} ${msg}`);
    },
    warn: (msg) => console.warn(`${yellow}[orchestrator]${reset} ${msg}`),
    error: (msg) => console.error(`${red}[orchestrator]${reset} ${msg}`),
    onGraphReady: (graph: TaskGraph, roles: TeamRole[]) => {
      console.log(`\n${cyan}[orchestrator]${reset} ${bold}Execution Plan${reset}`);
      console.log(`${cyan}[orchestrator]${reset} Roles: ${roles.join(', ')}`);
      console.log(`${cyan}[orchestrator]${reset} Nodes:`);

      for (const node of graph.nodes) {
        const deps = node.deps.length > 0 ? ` (after: ${node.deps.join(', ')})` : ' (start)';
        const opt = node.optional ? ` ${dim}[optional]${reset}` : '';
        const input = node.input ? `\n${cyan}[orchestrator]${reset}   task: ${dim}${node.input.length > 80 ? node.input.slice(0, 80) + '...' : node.input}${reset}` : '';
        console.log(`${cyan}[orchestrator]${reset}   - ${bold}${node.id}${reset} (${node.role})${deps}${opt}${input}`);
      }

      const layers: string[][] = [];
      const placed = new Set<string>();
      while (placed.size < graph.nodes.length) {
        const layer = graph.nodes
          .filter(n => !placed.has(n.id) && n.deps.every(d => placed.has(d)))
          .map(n => n.id);
        if (layer.length === 0) break;
        layers.push(layer);
        layer.forEach(id => placed.add(id));
      }
      const flow = layers.map(l => l.length === 1 ? l[0] : `[${l.join(' | ')}]`).join(' → ');
      console.log(`${cyan}[orchestrator]${reset} Flow: ${flow}\n`);
    },
  };

  return new Orchestrator({ runner, llmCall, logger });
}

function parseTeamArgs(args: string[]): { route?: OrchestrationInput['route']; task: string } {
  let route: OrchestrationInput['route'] | undefined;
  const rest: string[] = [];

  for (const arg of args) {
    if (arg.startsWith('--route=')) {
      route = arg.slice('--route='.length) as OrchestrationInput['route'];
    } else {
      rest.push(arg);
    }
  }

  return { route, task: rest.join(' ') };
}

export async function runTeam(agent: PulseAgent, args: string[]): Promise<void> {
  const { route, task } = parseTeamArgs(args);
  if (!task) {
    console.log('\n❌ Please provide a task description');
    console.log('Usage: /team <task>                  (default: LLM plans the DAG)');
    console.log('       /team --route=auto <task>      (keyword-based routing)');
    console.log('       /team --route=all <task>       (all roles participate)');
    return;
  }

  console.log(`\n${cyan}[orchestrator]${reset} Starting team run...`);

  const activeNodes = new Set<string>();
  const orchestrator = createOrchestrator(agent, activeNodes);
  const startTime = Date.now();

  const heartbeat = setInterval(() => {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    const active = activeNodes.size > 0
      ? ` running: ${Array.from(activeNodes).join(', ')}`
      : '';
    process.stdout.write(`${dim}[orchestrator] ${elapsed}s elapsed${active}${reset}\n`);
  }, 5000);

  try {
    const result = await orchestrator.run({
      task,
      ...(route ? { route } : {}),
    });

    clearInterval(heartbeat);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n${cyan}[orchestrator]${reset} Completed in ${elapsed}s — ${result.roles.length} roles, ${result.graph.nodes.length} nodes`);

    for (const node of result.graph.nodes) {
      const nr = result.results[node.id];
      if (!nr) continue;
      const icon = nr.status === 'success' ? '✓' : nr.status === 'skipped' ? '⊘' : '✗';
      const dur = (nr.durationMs / 1000).toFixed(1);
      console.log(`  ${icon} ${node.id} (${node.role}) ${nr.status} [${dur}s]`);
    }

    console.log('\n' + result.aggregate);
  } catch (error: any) {
    clearInterval(heartbeat);
    console.error(`\n${cyan}[orchestrator]${reset} Error: ${error.message}`);
  }
}

// ─── /teams (independent engine teams) with session persistence ────

interface TeamsArgs {
  task: string;
  concurrency: number;
  cwd?: string;
  verbose: boolean;
}

function parseTeamsArgs(args: string[]): TeamsArgs | null {
  let concurrency = 0;
  const concIdx = args.indexOf('--concurrency');
  if (concIdx !== -1 && args[concIdx + 1]) {
    concurrency = parseInt(args[concIdx + 1], 10);
    if (isNaN(concurrency) || concurrency < 1) {
      console.log('\n❌ --concurrency must be a positive integer');
      return null;
    }
  }

  let cwd: string | undefined;
  const cwdIdx = args.indexOf('--cwd');
  if (cwdIdx !== -1 && args[cwdIdx + 1]) {
    const path = require('path');
    const fs = require('fs');
    cwd = path.resolve(args[cwdIdx + 1]);
    if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
      console.log(`\n❌ --cwd path does not exist or is not a directory: ${cwd}`);
      return null;
    }
  }

  const verbose = args.includes('--verbose') || args.includes('-v');
  const filteredArgs = args.filter((a, i) =>
    a !== '--verbose' && a !== '-v' &&
    a !== '--concurrency' && (concIdx === -1 || i !== concIdx + 1) &&
    a !== '--cwd' && (cwdIdx === -1 || i !== cwdIdx + 1)
  );
  const task = filteredArgs.join(' ').trim();

  if (!task) {
    console.log('\n❌ Please provide a task description');
    console.log('Usage: /teams <task> [--concurrency N] [--cwd <dir>] [--verbose]');
    return null;
  }

  return { task, concurrency, cwd, verbose };
}

/**
 * Persistent teams session. Once started via `/teams`, stays alive so
 * subsequent plain messages are routed as follow-ups. Exit with `/solo`.
 */
export class TeamsSession {
  private lead: TeamLead;
  private display: InProcessDisplay;
  private concurrency: number;
  private _active = false;

  private constructor(lead: TeamLead, display: InProcessDisplay, concurrency: number) {
    this.lead = lead;
    this.display = display;
    this.concurrency = concurrency;
  }

  get active(): boolean { return this._active; }

  /**
   * Start a new teams session: plan → spawn → execute → synthesize.
   * Returns the session (now active) or null if args were invalid.
   */
  static async start(args: string[]): Promise<TeamsSession | null> {
    const parsed = parseTeamsArgs(args);
    if (!parsed) return null;

    const { task, concurrency, cwd, verbose } = parsed;

    const lead = new TeamLead({
      teamName: `team-${Date.now()}`,
      cwd,
      logger: { debug() {}, info() {}, warn(m: string) { console.warn(m); }, error(m: string) { console.error(m); } },
      defaultTeammateEngineOptions: { disableBuiltInPlugins: true },
    });

    const display = new InProcessDisplay(lead.team, { showOutput: verbose });
    display.start();

    const session = new TeamsSession(lead, display, concurrency);

    try {
      await lead.initialize();

      console.log(`\n${bold}━━━ Agent Teams ━━━${reset}${concurrency ? `  ${dim}concurrency: ${concurrency}${reset}` : ''}${cwd ? `  ${dim}cwd: ${cwd}${reset}` : ''}`);
      console.log(`${dim}  ${task}${reset}\n`);
      console.log(`  ${bold}${cyan}[1]${reset} ${bold}Planning${reset}\n`);

      const { synthesis } = await lead.orchestrate(task, {
        concurrency,
        onPlan: async (plan: TeamPlan) => {
          console.log(`  ${dim}Teammates: ${plan.teammates.map(t => t.name).join(', ')}${reset}`);
          console.log(`  ${dim}Tasks: ${plan.tasks.length}${reset}\n`);
          return true;
        },
      });

      console.log('\n' + synthesis + '\n');
      console.log(`${dim}Entered teams mode. Messages will be sent as follow-ups. Use /solo to exit.${reset}`);
      session._active = true;
      return session;
    } catch (err: any) {
      console.error(`\n❌ Agent teams failed: ${err.message}`);
      await session.stop();
      return null;
    }
  }

  /**
   * Send a follow-up message to the existing team.
   */
  async followUp(message: string): Promise<void> {
    try {
      console.log(`\n  ${bold}${cyan}[1]${reset} ${bold}Planning follow-up${reset}\n`);
      const { synthesis } = await this.lead.followUp(message, {
        concurrency: this.concurrency,
        onPlan: async (plan: TeamPlan) => {
          console.log(`  ${dim}Tasks: ${plan.tasks.length}${reset}\n`);
          return true;
        },
      });
      console.log('\n' + synthesis + '\n');
    } catch (err: any) {
      console.error(`\n❌ Follow-up failed: ${err.message}`);
    }
  }

  /**
   * Tear down the session, clean up team resources.
   */
  async stop(): Promise<void> {
    this._active = false;
    try { await this.lead.team.cleanup(); } catch { /* best effort */ }
    this.display.stop();
    console.log(`\n${dim}Exited teams mode.${reset}`);
  }
}
