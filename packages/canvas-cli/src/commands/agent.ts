import { Command } from 'commander';
import { output, errorOutput, type OutputFormat } from '../output';
import { postRuntime, readRuntime, runtimeAuthHint, type RuntimeInfo } from '../core/runtime-control';

function getOpts(cmd: Command): { format: OutputFormat; workspace: string } {
  const root = cmd.parent?.parent ?? cmd.parent;
  const opts = root?.opts() ?? {};
  const workspace = opts.workspace as string | undefined;
  if (!workspace) {
    errorOutput('Workspace ID required. Use --workspace <id> or set $PULSE_CANVAS_WORKSPACE_ID');
  }
  return { format: opts.format ?? 'text', workspace };
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
  return postRuntime(runtime, '/agent/send', { workspaceId, nodeId, input }) as Promise<{ status: number; body: SendResponse }>;
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
        errorOutput(runtimeAuthHint());
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
