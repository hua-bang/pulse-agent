import { promises as fs } from 'fs';
import { Command } from 'commander';
import { errorOutput, output } from '../output';
import { getWorkspaceCommandOptions } from './options';
import { postRuntime, readRuntime, runtimeAuthHint, type RuntimeInfo } from '../core/runtime-control';

const ENV_TEAM_ID = 'PULSE_CANVAS_TEAM_ID';
const ENV_TEAM_AGENT_ID = 'PULSE_CANVAS_TEAM_AGENT_ID';

interface ProposePlanResponse {
  ok: boolean;
  snapshot?: {
    runtime?: {
      team?: { id: string; name?: string };
    };
    pendingPlan?: {
      teammates?: unknown[];
      tasks?: unknown[];
    };
  };
  error?: string;
  code?: string;
}

interface TeamSnapshotResponse {
  ok: boolean;
  snapshot?: {
    runtime?: {
      team?: { id: string; name?: string; status?: string };
      tasks?: unknown[];
      messages?: unknown[];
    };
  };
  error?: string;
  code?: string;
}

interface TeamStatusResponse {
  ok: boolean;
  snapshot?: {
    phase?: string;
    sessions?: Record<string, string>;
    runtime?: {
      team?: { id: string; name?: string; status?: string; goal?: string };
      agents?: Array<{
        id: string;
        name: string;
        role: string;
        status: string;
        currentTaskId?: string;
      }>;
      tasks?: Array<{
        id: string;
        title: string;
        status: string;
        ownerAgentId?: string;
        blockedReason?: string;
      }>;
      humanGates?: Array<{
        id: string;
        status: string;
        prompt: string;
        agentId?: string;
        taskId?: string;
      }>;
    };
  };
  teams?: Array<{
    teamId: string;
    name: string;
    status: string;
    phase: string;
    taskCounts: Record<string, number>;
    agentCount: number;
  }>;
  error?: string;
  code?: string;
}

const renderTeamStatus = (response: TeamStatusResponse): string => {
  if (response.teams) {
    if (response.teams.length === 0) return 'No agent teams in this workspace.';
    const lines = response.teams.map((team) => {
      const counts = Object.entries(team.taskCounts)
        .map(([status, count]) => `${count} ${status}`)
        .join(', ') || 'no tasks';
      return `${team.name} (${team.teamId}) — ${team.status} · ${team.phase} · ${team.agentCount} agents · ${counts}`;
    });
    return [...lines, '', 'Run with --team <id> for task, agent, and session detail.'].join('\n');
  }

  const runtime = response.snapshot?.runtime ?? {};
  const sessions = response.snapshot?.sessions ?? {};
  const team = runtime.team;
  const agents = runtime.agents ?? [];
  const tasks = runtime.tasks ?? [];
  const agentById = new Map(agents.map((agent) => [agent.id, agent]));
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const lines: string[] = [];

  lines.push(`Team: ${team?.name ?? 'unknown'} (${team?.id ?? '?'})`);
  lines.push(`Status: ${team?.status ?? 'unknown'} · phase ${response.snapshot?.phase ?? 'unknown'}`);

  lines.push('', `Agents (${agents.length}):`);
  for (const agent of agents) {
    const session = sessions[agent.id] ?? 'unknown';
    const current = agent.currentTaskId ? taskById.get(agent.currentTaskId)?.title : undefined;
    lines.push(
      `- ${agent.name} [${agent.role}] ${agent.status} · session ${session}`
      + (current ? ` · working on: ${current}` : ''),
    );
  }

  lines.push('', `Tasks (${tasks.length}):`);
  for (const task of tasks) {
    const owner = task.ownerAgentId ? agentById.get(task.ownerAgentId)?.name : undefined;
    lines.push(`- [${task.status}] ${task.title} — ${owner ?? 'unassigned'} (${task.id})`);
    if (task.blockedReason) lines.push(`    blocker: ${task.blockedReason}`);
  }

  const openGates = (runtime.humanGates ?? []).filter((gate) => gate.status === 'open');
  if (openGates.length > 0) {
    lines.push('', `Open questions (${openGates.length}):`);
    for (const gate of openGates) {
      const from = gate.agentId ? agentById.get(gate.agentId)?.name ?? 'agent' : 'team';
      lines.push(`- ${from}: ${gate.prompt}`);
    }
  }

  const pendingReviews = tasks.filter((task) => task.status === 'needs_review');
  if (pendingReviews.length > 0) {
    lines.push('', `Waiting for Team Lead review (${pendingReviews.length}):`);
    for (const task of pendingReviews) {
      lines.push(`- ${task.title}: pulse-canvas team complete-task --task "${task.id}" --summary "<reviewed summary>"`);
    }
  }

  const deadSessions = agents.filter((agent) => {
    const session = sessions[agent.id];
    return session === 'dead' || session === 'missing';
  });
  if (deadSessions.length > 0) {
    lines.push('', `Sessions needing relaunch (${deadSessions.length}): ${deadSessions.map((agent) => agent.name).join(', ')}`);
    lines.push('Open the workspace window to relaunch them; queued messages deliver on relaunch.');
  }

  return lines.join('\n');
};

const collectOption = (value: string, previous: string[] = []): string[] => [...previous, value];

async function readPlan(cmdOpts: { planFile?: string; planJson?: string }): Promise<unknown> {
  let raw = cmdOpts.planJson;
  if (!raw && cmdOpts.planFile) {
    try {
      raw = await fs.readFile(cmdOpts.planFile, 'utf-8');
    } catch (err) {
      errorOutput(`Cannot read plan file (${cmdOpts.planFile}): ${(err as Error).message}`);
    }
  }
  if (!raw) {
    errorOutput('Plan required. Pass --plan-file <path> or --plan-json <json>.');
  }
  try {
    return JSON.parse(raw!);
  } catch (err) {
    errorOutput(`Plan is not valid JSON: ${(err as Error).message}`);
  }
}

async function postProposePlan(
  runtime: RuntimeInfo,
  body: {
    workspaceId: string;
    teamId: string;
    sourceAgentId?: string;
    plan: unknown;
  },
): Promise<{ status: number; body: ProposePlanResponse }> {
  return postRuntime(runtime, '/agent-team/propose-plan', body) as Promise<{ status: number; body: ProposePlanResponse }>;
}

async function postTeamAction(
  runtime: RuntimeInfo,
  path:
    | '/agent-team/create-task'
    | '/agent-team/complete-task'
    | '/agent-team/block-task'
    | '/agent-team/cancel-task'
    | '/agent-team/request-human-input'
    | '/agent-team/publish-artifact'
    | '/agent-team/complete-team'
    | '/agent-team/dispatch'
    | '/agent-team/send',
  body: Record<string, unknown>,
): Promise<{ status: number; body: TeamSnapshotResponse }> {
  return postRuntime(runtime, path, body) as Promise<{ status: number; body: TeamSnapshotResponse }>;
}

const baseTeamBody = (workspace: string, teamId: string): Record<string, unknown> => ({
  workspaceId: workspace,
  teamId,
});

const addSourceAgent = (body: Record<string, unknown>, sourceAgent?: string): Record<string, unknown> => ({
  ...body,
  sourceAgentId: sourceAgent || process.env[ENV_TEAM_AGENT_ID],
});

const textFromOptionOrParts = (optionValue: string | undefined, parts: string[] | undefined, label: string): string => {
  const content = (optionValue || (parts ?? []).join(' ')).trim();
  if (!content) errorOutput(`${label} required. Pass --${label.toLowerCase()} <text> or trailing text.`);
  return content;
};

export function registerTeamCommands(program: Command): void {
  const team = program
    .command('team')
    .description('Interact with Pulse Canvas Agent Teams');

  team.command('propose-plan')
    .option('--team <teamId>', `Team ID (default: $${ENV_TEAM_ID})`, process.env[ENV_TEAM_ID])
    .option('--source-agent <agentId>', `Source team agent ID (default: $${ENV_TEAM_AGENT_ID})`, process.env[ENV_TEAM_AGENT_ID])
    .option('--plan-file <path>', 'Path to a JSON plan file')
    .option('--plan-json <json>', 'Inline JSON plan')
    .description('Submit a proposed team plan for user approval')
    .action(async function (
      this: Command,
      cmdOpts: {
        team?: string;
        sourceAgent?: string;
        planFile?: string;
        planJson?: string;
      },
    ) {
      const { format, workspace } = await getWorkspaceCommandOptions(this, { requireReadableCanvas: false });
      const teamId = cmdOpts.team || process.env[ENV_TEAM_ID];
      if (!teamId) {
        errorOutput(`Team ID required. Pass --team <id> or set $${ENV_TEAM_ID}.`);
      }

      const plan = await readPlan(cmdOpts);
      const runtime = await readRuntime();
      const { status, body } = await postProposePlan(runtime, {
        workspaceId: workspace,
        teamId,
        sourceAgentId: cmdOpts.sourceAgent || process.env[ENV_TEAM_AGENT_ID],
        plan,
      });

      if (status === 401) errorOutput(runtimeAuthHint());
      if (!body.ok) errorOutput(body.error ?? `HTTP ${status}`);

      output(body, format, (data) => {
        const response = data as ProposePlanResponse;
        const pending = response.snapshot?.pendingPlan;
        const teammateCount = pending?.teammates?.length ?? 0;
        const taskCount = pending?.tasks?.length ?? 0;
        const name = response.snapshot?.runtime?.team?.name || teamId;
        return `Plan proposed for ${name}: ${teammateCount} teammates, ${taskCount} tasks.`;
      });
    });

  team.command('create-task')
    .option('--team <teamId>', `Team ID (default: $${ENV_TEAM_ID})`, process.env[ENV_TEAM_ID])
    .option('--source-agent <agentId>', `Source agent ID (default: $${ENV_TEAM_AGENT_ID})`, process.env[ENV_TEAM_AGENT_ID])
    .requiredOption('--title <title>', 'Task title')
    .requiredOption('--description <description>', 'Task instructions')
    .option('--owner <agent>', 'Owner agent name or ID')
    .option('--dep <task>', 'Dependency task title or ID; repeat for multiple dependencies', collectOption, [])
    .option('--scope <path>', 'File or directory path this task may modify; repeat for multiple paths', collectOption, [])
    .option('--verify <command>', 'Cheap verification command re-run at submission (or "manual")')
    .option('--dispatch', 'Dispatch ready tasks after creating this task')
    .description('Create a follow-up task in the current team (Team Lead only)')
    .action(async function (
      this: Command,
      cmdOpts: {
        team?: string;
        sourceAgent?: string;
        title: string;
        description: string;
        owner?: string;
        dep?: string[];
        scope?: string[];
        verify?: string;
        dispatch?: boolean;
      },
    ) {
      const { format, workspace } = await getWorkspaceCommandOptions(this, { requireReadableCanvas: false });
      const teamId = cmdOpts.team || process.env[ENV_TEAM_ID];
      if (!teamId) errorOutput(`Team ID required. Pass --team <id> or set $${ENV_TEAM_ID}.`);

      const runtime = await readRuntime();
      const { status, body } = await postTeamAction(runtime, '/agent-team/create-task', addSourceAgent({
        workspaceId: workspace,
        teamId,
        title: cmdOpts.title,
        description: cmdOpts.description,
        ownerName: cmdOpts.owner,
        depRefs: cmdOpts.dep ?? [],
        ...(cmdOpts.scope && cmdOpts.scope.length > 0 ? { scope: cmdOpts.scope } : {}),
        ...(cmdOpts.verify ? { verify: cmdOpts.verify } : {}),
        dispatch: cmdOpts.dispatch === true,
      }, cmdOpts.sourceAgent));

      if (status === 401) errorOutput(runtimeAuthHint());
      if (!body.ok) errorOutput(body.error ?? `HTTP ${status}`);

      output(body, format, (data) => {
        const response = data as TeamSnapshotResponse;
        const name = response.snapshot?.runtime?.team?.name || teamId;
        return `Task created for ${name}${cmdOpts.dispatch ? ' and dispatch requested' : ''}.`;
      });
    });

  team.command('dispatch')
    .option('--team <teamId>', `Team ID (default: $${ENV_TEAM_ID})`, process.env[ENV_TEAM_ID])
    .description('Dispatch ready team tasks')
    .action(async function (this: Command, cmdOpts: { team?: string }) {
      const { format, workspace } = await getWorkspaceCommandOptions(this, { requireReadableCanvas: false });
      const teamId = cmdOpts.team || process.env[ENV_TEAM_ID];
      if (!teamId) errorOutput(`Team ID required. Pass --team <id> or set $${ENV_TEAM_ID}.`);

      const runtime = await readRuntime();
      const { status, body } = await postTeamAction(runtime, '/agent-team/dispatch', {
        workspaceId: workspace,
        teamId,
      });

      if (status === 401) errorOutput(runtimeAuthHint());
      if (!body.ok) errorOutput(body.error ?? `HTTP ${status}`);

      output(body, format, (data) => {
        const response = data as TeamSnapshotResponse;
        const name = response.snapshot?.runtime?.team?.name || teamId;
        const statusLabel = response.snapshot?.runtime?.team?.status;
        return `Dispatch checked for ${name}${statusLabel ? ` (${statusLabel})` : ''}.`;
      });
    });

  team.command('complete-task')
    .option('--team <teamId>', `Team ID (default: $${ENV_TEAM_ID})`, process.env[ENV_TEAM_ID])
    .option('--source-agent <agentId>', `Source agent ID (default: $${ENV_TEAM_AGENT_ID})`, process.env[ENV_TEAM_AGENT_ID])
    .option('--task <taskId>', 'Task ID or title (defaults to source agent current task)')
    .option('--summary <summary>', 'Completion summary')
    .argument('[summary...]', 'Completion summary')
    .description('Mark a team task complete and dispatch newly-unblocked work')
    .action(async function (
      this: Command,
      summaryParts: string[] | undefined,
      cmdOpts: { team?: string; sourceAgent?: string; task?: string; summary?: string },
    ) {
      const { format, workspace } = await getWorkspaceCommandOptions(this, { requireReadableCanvas: false });
      const teamId = cmdOpts.team || process.env[ENV_TEAM_ID];
      if (!teamId) errorOutput(`Team ID required. Pass --team <id> or set $${ENV_TEAM_ID}.`);
      const summary = textFromOptionOrParts(cmdOpts.summary, summaryParts, 'Summary');

      const runtime = await readRuntime();
      const { status, body } = await postTeamAction(runtime, '/agent-team/complete-task', addSourceAgent({
        ...baseTeamBody(workspace, teamId),
        taskId: cmdOpts.task,
        summary,
      }, cmdOpts.sourceAgent));

      if (status === 401) errorOutput(runtimeAuthHint());
      if (!body.ok) errorOutput(body.error ?? `HTTP ${status}`);

      output(body, format, (data) => {
        const response = data as { task?: { status?: string; title?: string } };
        if (response.task?.status === 'needs_review') {
          const title = response.task.title ? `"${response.task.title}"` : 'task';
          return `Completion submitted for Team Lead review: ${title}. The task stays open until the Team Lead accepts it; you may receive revision feedback.`;
        }
        return `Task completed for ${teamId}.`;
      });
    });

  team.command('block-task')
    .option('--team <teamId>', `Team ID (default: $${ENV_TEAM_ID})`, process.env[ENV_TEAM_ID])
    .option('--source-agent <agentId>', `Source agent ID (default: $${ENV_TEAM_AGENT_ID})`, process.env[ENV_TEAM_AGENT_ID])
    .option('--task <taskId>', 'Task ID or title (defaults to source agent current task)')
    .option('--reason <reason>', 'Blocker reason')
    .argument('[reason...]', 'Blocker reason')
    .description('Mark a team task blocked and notify the leader')
    .action(async function (
      this: Command,
      reasonParts: string[] | undefined,
      cmdOpts: { team?: string; sourceAgent?: string; task?: string; reason?: string },
    ) {
      const { format, workspace } = await getWorkspaceCommandOptions(this, { requireReadableCanvas: false });
      const teamId = cmdOpts.team || process.env[ENV_TEAM_ID];
      if (!teamId) errorOutput(`Team ID required. Pass --team <id> or set $${ENV_TEAM_ID}.`);
      const reason = textFromOptionOrParts(cmdOpts.reason, reasonParts, 'Reason');

      const runtime = await readRuntime();
      const { status, body } = await postTeamAction(runtime, '/agent-team/block-task', addSourceAgent({
        ...baseTeamBody(workspace, teamId),
        taskId: cmdOpts.task,
        reason,
      }, cmdOpts.sourceAgent));

      if (status === 401) errorOutput(runtimeAuthHint());
      if (!body.ok) errorOutput(body.error ?? `HTTP ${status}`);

      output(body, format, () => `Task blocked for ${teamId}.`);
    });

  team.command('status')
    .option('--team <teamId>', `Team ID (default: $${ENV_TEAM_ID}; omit to list all teams)`, process.env[ENV_TEAM_ID])
    .description('Show read-only team status: agents, session health, tasks, open questions, pending reviews')
    .action(async function (this: Command, cmdOpts: { team?: string }) {
      const { format, workspace } = await getWorkspaceCommandOptions(this, { requireReadableCanvas: false });
      const teamId = cmdOpts.team || process.env[ENV_TEAM_ID] || undefined;

      const runtime = await readRuntime();
      const { status, body } = await postRuntime(runtime, '/agent-team/status', {
        workspaceId: workspace,
        ...(teamId ? { teamId } : {}),
      }) as { status: number; body: TeamStatusResponse };

      if (status === 401) errorOutput(runtimeAuthHint());
      if (!body.ok) errorOutput(body.error ?? `HTTP ${status}`);

      output(body, format, (data) => renderTeamStatus(data as TeamStatusResponse));
    });

  team.command('cancel-task')
    .option('--team <teamId>', `Team ID (default: $${ENV_TEAM_ID})`, process.env[ENV_TEAM_ID])
    .option('--source-agent <agentId>', `Source agent ID (default: $${ENV_TEAM_AGENT_ID})`, process.env[ENV_TEAM_AGENT_ID])
    .option('--task <taskId>', 'Task ID or title')
    .option('--reason <reason>', 'Cancellation reason')
    .argument('[reason...]', 'Cancellation reason')
    .description('Cancel a task and release its file scope for replacement work (Team Lead or human only)')
    .action(async function (
      this: Command,
      reasonParts: string[] | undefined,
      cmdOpts: { team?: string; sourceAgent?: string; task?: string; reason?: string },
    ) {
      const { format, workspace } = await getWorkspaceCommandOptions(this, { requireReadableCanvas: false });
      const teamId = cmdOpts.team || process.env[ENV_TEAM_ID];
      if (!teamId) errorOutput(`Team ID required. Pass --team <id> or set $${ENV_TEAM_ID}.`);
      const reason = textFromOptionOrParts(cmdOpts.reason, reasonParts, 'Reason');

      const runtime = await readRuntime();
      const { status, body } = await postTeamAction(runtime, '/agent-team/cancel-task', addSourceAgent({
        ...baseTeamBody(workspace, teamId),
        taskId: cmdOpts.task,
        reason,
      }, cmdOpts.sourceAgent));

      if (status === 401) errorOutput(runtimeAuthHint());
      if (!body.ok) errorOutput(body.error ?? `HTTP ${status}`);

      output(body, format, () => `Task cancelled for ${teamId}; its file scope is released.`);
    });

  team.command('request-human-input')
    .option('--team <teamId>', `Team ID (default: $${ENV_TEAM_ID})`, process.env[ENV_TEAM_ID])
    .option('--source-agent <agentId>', `Source agent ID (default: $${ENV_TEAM_AGENT_ID})`, process.env[ENV_TEAM_AGENT_ID])
    .option('--task <taskId>', 'Task ID or title (defaults to source agent current task)')
    .option('--reason <reason>', 'Short reason for the question')
    .option('--prompt <prompt>', 'Question for the Team Lead or user')
    .argument('[prompt...]', 'Question for the Team Lead or user')
    .description('Request input for a task; teammate requests go to the Team Lead first')
    .action(async function (
      this: Command,
      promptParts: string[] | undefined,
      cmdOpts: { team?: string; sourceAgent?: string; task?: string; reason?: string; prompt?: string },
    ) {
      const { format, workspace } = await getWorkspaceCommandOptions(this, { requireReadableCanvas: false });
      const teamId = cmdOpts.team || process.env[ENV_TEAM_ID];
      if (!teamId) errorOutput(`Team ID required. Pass --team <id> or set $${ENV_TEAM_ID}.`);
      const prompt = textFromOptionOrParts(cmdOpts.prompt, promptParts, 'Prompt');

      const runtime = await readRuntime();
      const { status, body } = await postTeamAction(runtime, '/agent-team/request-human-input', addSourceAgent({
        ...baseTeamBody(workspace, teamId),
        taskId: cmdOpts.task,
        reason: cmdOpts.reason,
        prompt,
      }, cmdOpts.sourceAgent));

      if (status === 401) errorOutput(runtimeAuthHint());
      if (!body.ok) errorOutput(body.error ?? `HTTP ${status}`);

      output(body, format, () => `Input requested for ${teamId}.`);
    });

  team.command('publish-artifact')
    .option('--team <teamId>', `Team ID (default: $${ENV_TEAM_ID})`, process.env[ENV_TEAM_ID])
    .option('--source-agent <agentId>', `Source agent ID (default: $${ENV_TEAM_AGENT_ID})`, process.env[ENV_TEAM_AGENT_ID])
    .option('--task <taskId>', 'Task ID or title (defaults to source agent current task)')
    .option('--kind <kind>', 'Artifact kind', 'other')
    .requiredOption('--title <title>', 'Artifact title')
    .option('--uri <uri>', 'Artifact URI or path')
    .option('--summary <summary>', 'Artifact summary')
    .argument('[summary...]', 'Artifact summary')
    .description('Publish a task artifact to the team mailbox')
    .action(async function (
      this: Command,
      summaryParts: string[] | undefined,
      cmdOpts: {
        team?: string;
        sourceAgent?: string;
        task?: string;
        kind?: string;
        title: string;
        uri?: string;
        summary?: string;
      },
    ) {
      const { format, workspace } = await getWorkspaceCommandOptions(this, { requireReadableCanvas: false });
      const teamId = cmdOpts.team || process.env[ENV_TEAM_ID];
      if (!teamId) errorOutput(`Team ID required. Pass --team <id> or set $${ENV_TEAM_ID}.`);
      const summary = (cmdOpts.summary || (summaryParts ?? []).join(' ')).trim() || undefined;

      const runtime = await readRuntime();
      const { status, body } = await postTeamAction(runtime, '/agent-team/publish-artifact', addSourceAgent({
        ...baseTeamBody(workspace, teamId),
        taskId: cmdOpts.task,
        kind: cmdOpts.kind,
        title: cmdOpts.title,
        uri: cmdOpts.uri,
        summary,
      }, cmdOpts.sourceAgent));

      if (status === 401) errorOutput(runtimeAuthHint());
      if (!body.ok) errorOutput(body.error ?? `HTTP ${status}`);

      output(body, format, () => `Artifact published for ${teamId}: ${cmdOpts.title}.`);
    });

  team.command('complete-team')
    .option('--team <teamId>', `Team ID (default: $${ENV_TEAM_ID})`, process.env[ENV_TEAM_ID])
    .option('--source-agent <agentId>', `Source agent ID (default: $${ENV_TEAM_AGENT_ID})`, process.env[ENV_TEAM_AGENT_ID])
    .option('--summary <summary>', 'Final team summary')
    .argument('[summary...]', 'Final team summary')
    .description('Mark the whole team complete after review (Team Lead only)')
    .action(async function (
      this: Command,
      summaryParts: string[] | undefined,
      cmdOpts: { team?: string; sourceAgent?: string; summary?: string },
    ) {
      const { format, workspace } = await getWorkspaceCommandOptions(this, { requireReadableCanvas: false });
      const teamId = cmdOpts.team || process.env[ENV_TEAM_ID];
      if (!teamId) errorOutput(`Team ID required. Pass --team <id> or set $${ENV_TEAM_ID}.`);
      const summary = textFromOptionOrParts(cmdOpts.summary, summaryParts, 'Summary');

      const runtime = await readRuntime();
      const { status, body } = await postTeamAction(runtime, '/agent-team/complete-team', addSourceAgent({
        ...baseTeamBody(workspace, teamId),
        summary,
      }, cmdOpts.sourceAgent));

      if (status === 401) errorOutput(runtimeAuthHint());
      if (!body.ok) errorOutput(body.error ?? `HTTP ${status}`);

      output(body, format, () => `Team completed: ${teamId}.`);
    });

  team.command('send')
    .option('--team <teamId>', `Team ID (default: $${ENV_TEAM_ID})`, process.env[ENV_TEAM_ID])
    .requiredOption('--to <agent>', 'Target agent name or ID')
    .option('--task <taskId>', 'Task ID or title to answer a specific open question from that agent')
    .option('--message <message>', 'Message content')
    .argument('[message...]', 'Message content')
    .description('Send a team message to an agent')
    .action(async function (
      this: Command,
      messageParts: string[] | undefined,
      cmdOpts: { team?: string; to: string; task?: string; message?: string },
    ) {
      const { format, workspace } = await getWorkspaceCommandOptions(this, { requireReadableCanvas: false });
      const teamId = cmdOpts.team || process.env[ENV_TEAM_ID];
      if (!teamId) errorOutput(`Team ID required. Pass --team <id> or set $${ENV_TEAM_ID}.`);
      const content = (cmdOpts.message || (messageParts ?? []).join(' ')).trim();
      if (!content) errorOutput('Message required. Pass --message <text> or trailing message text.');

      const runtime = await readRuntime();
      const { status, body } = await postTeamAction(runtime, '/agent-team/send', {
        workspaceId: workspace,
        teamId,
        to: cmdOpts.to,
        taskId: cmdOpts.task,
        content,
      });

      if (status === 401) errorOutput(runtimeAuthHint());
      if (!body.ok) errorOutput(body.error ?? `HTTP ${status}`);

      output(body, format, (data) => {
        const response = data as TeamSnapshotResponse;
        const name = response.snapshot?.runtime?.team?.name || teamId;
        return `Message sent in ${name} to ${cmdOpts.to}.`;
      });
    });
}
