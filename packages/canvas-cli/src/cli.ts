import { Command } from 'commander';
import { registerWorkspaceCommands } from './commands/workspace';
import { registerNodeCommands } from './commands/node';
import { registerContextCommand } from './commands/context';
import { registerInstallSkillsCommand } from './commands/install-skills';
import { registerEdgeCommands } from './commands/edge';
import { registerAgentCommands } from './commands/agent';
import { registerRestoreCommand } from './commands/restore';
import { registerTeamCommands } from './commands/team';
import { ENV_WORKSPACE_ID } from './core/workspace-resolution';
import { setActiveFormat } from './output';

export { ENV_WORKSPACE_ID };

export function createCli(): Command {
  const program = new Command();

  program
    .name('pulse-canvas')
    .description('CLI for Pulse Canvas — agent communication channel for canvas workspaces')
    .version('0.0.1-alpha.1')
    .option('--format <format>', 'Output format: json or text', 'text')
    .option('--store-dir <path>', 'Canvas store directory (default: ~/.pulse-coder/canvas/)')
    .option(
      '-w, --workspace <id>',
      `Workspace ID (default: active workspace, or $${ENV_WORKSPACE_ID})`,
    )
    .option(
      '--confine-to-workspace',
      'Refuse to read/write file-node paths outside the workspace directory (safer for untrusted canvases)',
      false,
    );

  // Resolve the global output format once, before any action runs, so
  // `errorOutput` can emit structured JSON errors from anywhere without each
  // call site threading the format through.
  program.hook('preAction', () => {
    setActiveFormat(program.opts().format === 'json' ? 'json' : 'text');
  });

  registerWorkspaceCommands(program);
  registerNodeCommands(program);
  registerEdgeCommands(program);
  registerAgentCommands(program);
  registerTeamCommands(program);
  registerRestoreCommand(program);
  registerContextCommand(program);
  registerInstallSkillsCommand(program);

  return program;
}
