import { promises as fs } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { Command } from 'commander';
import { output, errorOutput, type OutputFormat } from '../output';

const RUNTIME_FILE = join(homedir(), '.pulse-coder', 'canvas-runtime', 'canvas-workspace.json');

interface RuntimeInfo {
  pid: number;
  baseUrl: string;
  secret: string;
  createdAt: string;
}

function getOpts(cmd: Command): { format: OutputFormat; workspace: string } {
  const root = cmd.parent?.parent ?? cmd.parent;
  const opts = root?.opts() ?? {};
  const workspace = opts.workspace as string | undefined;
  if (!workspace) {
    errorOutput('Workspace ID required. Use --workspace <id> or set $PULSE_CANVAS_WORKSPACE_ID');
  }
  return { format: opts.format ?? 'text', workspace };
}

async function readRuntime(): Promise<RuntimeInfo> {
  let raw: string;
  try {
    raw = await fs.readFile(RUNTIME_FILE, 'utf-8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      errorOutput(
        'No active canvas-workspace runtime found.\n' +
        'Open this workspace in Pulse Canvas before sending input to an agent node.',
      );
    }
    errorOutput(`Cannot read runtime file (${RUNTIME_FILE}): ${String(err)}`);
  }
  try {
    const info = JSON.parse(raw!) as RuntimeInfo;
    if (!info.baseUrl || !info.secret) {
      errorOutput('Runtime file is missing baseUrl or secret. Restart Pulse Canvas.');
    }
    return info;
  } catch {
    errorOutput('Runtime file is corrupt. Restart Pulse Canvas.');
  }
}

interface SendResponse {
  ok: boolean;
  nodeId?: string;
  bytesSent?: number;
  error?: string;
  code?: string;
}

async function postAgentSend(
  runtime: RuntimeInfo,
  workspaceId: string,
  nodeId: string,
  input: string,
): Promise<{ status: number; body: SendResponse }> {
  let res: Response;
  try {
    res = await fetch(`${runtime.baseUrl}/agent/send`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${runtime.secret}`,
      },
      body: JSON.stringify({ workspaceId, nodeId, input }),
    });
  } catch (err) {
    errorOutput(
      `Cannot reach canvas-workspace runtime at ${runtime.baseUrl}: ${(err as Error).message}\n` +
      'The Electron app may not be running, or the runtime file is stale.',
    );
  }
  let body: SendResponse;
  try {
    body = (await res!.json()) as SendResponse;
  } catch {
    body = { ok: false, error: `non-JSON response (HTTP ${res!.status})` };
  }
  return { status: res!.status, body };
}

export function registerAgentCommands(program: Command): void {
  const agent = program
    .command('agent')
    .description('Interact with running agent nodes');

  agent.command('send')
    .argument('<nodeId>', 'Target agent node ID')
    .requiredOption('--input <text>', 'Text to send to the agent (Enter is appended automatically)')
    .description('Send follow-up input to a running agent node')
    .action(async function (this: Command, nodeId: string, cmdOpts: { input: string }) {
      const { format, workspace } = getOpts(this);
      const runtime = await readRuntime();
      const { status, body } = await postAgentSend(runtime, workspace, nodeId, cmdOpts.input);

      if (status === 401) {
        errorOutput(
          'Runtime authentication failed (401). The secret in the runtime file does not match ' +
          'the running canvas-workspace. Restart Pulse Canvas to refresh it.',
        );
      }
      if (!body.ok) {
        const hint = hintForCode(body.code);
        errorOutput(`${body.error ?? `HTTP ${status}`}${hint ? `\n${hint}` : ''}`);
      }

      output(body, format, (d) => {
        const r = d as SendResponse;
        return `OK (sent ${r.bytesSent ?? 0} bytes to ${r.nodeId})`;
      });
    });
}

function hintForCode(code: string | undefined): string {
  switch (code) {
    case 'workspace_not_found':
      return 'Check that --workspace matches a workspace the app has opened.';
    case 'node_not_found':
      return 'The node may have been deleted, or you have the wrong nodeId.';
    case 'wrong_node_type':
      return 'Use `pulse-canvas node write` for file/frame/group nodes.';
    case 'not_running':
      return 'Launch the agent (open the node and start it) before sending follow-up input.';
    case 'no_session':
      return 'The agent node must be open in the canvas UI — its PTY is torn down when the node closes.';
    default:
      return '';
  }
}
