import { Command, Option, Argument } from 'commander';
import { NODE_CAPABILITIES, DEFAULT_NODE_DIMENSIONS } from '../core/constants';
import { CONTEXT_SCHEMA_VERSION } from '../core/context';
import { ENV_WORKSPACE_ID } from '../core/workspace-resolution';
import { output } from '../output';

/**
 * Version of the `describe` manifest itself. Bump when the manifest shape
 * changes so a caller can tell whether it understands the payload.
 */
const DESCRIBE_VERSION = 1;

interface CommandInfo {
  name: string;
  description: string;
  arguments: Array<{ name: string; required: boolean; variadic: boolean }>;
  options: Array<{ flags: string; description: string }>;
  subcommands: CommandInfo[];
}

function serializeCommand(cmd: Command): CommandInfo {
  const args = ((cmd as unknown as { registeredArguments?: Argument[] }).registeredArguments ?? []);
  return {
    name: cmd.name(),
    description: cmd.description(),
    arguments: args.map((a) => ({
      name: a.name(),
      required: (a as unknown as { required: boolean }).required,
      variadic: (a as unknown as { variadic: boolean }).variadic,
    })),
    options: cmd.options.map((o: Option) => ({ flags: o.flags, description: o.description })),
    subcommands: cmd.commands.map(serializeCommand),
  };
}

/**
 * Error `code` values the CLI emits (in `--format json` failures). Kept here as
 * the single documented list so external callers can enumerate what they may
 * need to branch on. Not exhaustive of transient runtime detail, but covers the
 * stable set.
 */
const ERROR_CODES = [
  'error',
  'no_workspace_selected',
  'workspace_not_found',
  'workspace_unsafe',
  'workspace_unreadable',
  'node_not_found',
  'edge_not_found',
  'invalid_argument',
  'unsupported',
  'path_confined',
  'confirmation_required',
  'io_error',
  'not_found',
  'runtime_not_found',
  'runtime_unreadable',
  'runtime_invalid',
  'runtime_corrupt',
  'runtime_unreachable',
  'runtime_auth',
  'runtime_error',
];

export function registerDescribeCommand(program: Command): void {
  program
    .command('describe')
    .description('Emit a machine-readable manifest of commands, node types, and error codes')
    .action(async function (this: Command) {
      let root: Command = this;
      while (root.parent) root = root.parent;

      const manifest = {
        describeVersion: DESCRIBE_VERSION,
        name: root.name(),
        version: root.version(),
        contextVersion: CONTEXT_SCHEMA_VERSION,
        workspaceResolutionOrder: ['--workspace', `$${ENV_WORKSPACE_ID}`, 'manifest-active'],
        globalOptions: root.options.map((o) => ({ flags: o.flags, description: o.description })),
        nodeTypes: {
          creatable: Object.keys(DEFAULT_NODE_DIMENSIONS),
          known: Object.keys(NODE_CAPABILITIES),
          capabilities: NODE_CAPABILITIES,
        },
        errorCodes: ERROR_CODES,
        commands: root.commands
          .filter((c) => c.name() !== 'describe')
          .map(serializeCommand),
      };

      const format = root.opts().format === 'json' ? 'json' : 'text';
      output(manifest, format, (data) => {
        const d = data as typeof manifest;
        const lines: string[] = [
          `${d.name} v${d.version}  (describe v${d.describeVersion}, context v${d.contextVersion})`,
          `Workspace resolution: ${d.workspaceResolutionOrder.join(' → ')}`,
          '',
          `Creatable node types: ${d.nodeTypes.creatable.join(', ')}`,
          `Known node types:     ${d.nodeTypes.known.join(', ')}`,
          '',
          'Commands:',
        ];
        for (const c of d.commands) {
          lines.push(`  ${c.name} — ${c.description}`);
          for (const s of c.subcommands) lines.push(`    ${c.name} ${s.name} — ${s.description}`);
        }
        lines.push('', `Error codes: ${d.errorCodes.join(', ')}`);
        lines.push('', 'Use --format json for the full machine-readable manifest.');
        return lines.join('\n');
      });
    });
}
