import { Command } from 'commander';
import { promises as fs } from 'fs';

import {
  listRuntimeCapabilities,
  callRuntimeCapability,
  MAX_PAGE_EVAL_TIMEOUT_MS,
  type RuntimeCapabilityDescriptor,
} from '../core/runtime-capabilities';
import { errorOutput, output } from '../output';
import { getRootOptions, getWorkspaceCommandOptions } from './options';

export function registerRuntimeCommands(program: Command): void {
  const runtime = program
    .command('runtime')
    .description('Discover and call capabilities in the running Pulse Canvas app');

  runtime.command('capabilities')
    .description('List live capabilities available to this external agent')
    .action(async function (this: Command) {
      const { format } = getRootOptions(this);
      const result = await listRuntimeCapabilities();
      if (!result.ok) errorOutput(result.error.message, { code: result.error.code });
      output(result.value, format, renderCapabilities);
    });

  runtime.command('call')
    .argument('<name>', 'Capability name from `runtime capabilities`')
    .requiredOption('--input <json>', 'Capability input as a JSON object')
    .description('Call one live application capability')
    .action(async function (this: Command, name: string, options: { input: string }) {
      const { format, workspace } = await getWorkspaceCommandOptions(
        this,
        { requireReadableCanvas: false },
      );
      const result = await callRuntimeCapability({
        workspaceId: workspace,
        name,
        input: parseJsonObject(options.input),
      });
      if (!result.ok) errorOutput(result.error.message, { code: result.error.code });
      output(result.value, format, renderRuntimeValue);
    });

  runtime.command('eval')
    .requiredOption('--node <nodeId>', 'Iframe canvas node id or right-dock link-tab id')
    .option('--code <javascript>', 'Inline JavaScript function body')
    .option('--file <path>', 'Read the JavaScript function body from a file')
    .option('--stdin', 'Read the JavaScript function body from stdin')
    .option('--timeout <ms>', 'Maximum execution time in milliseconds')
    .description('Execute JavaScript inside an open iframe node or dock link tab')
    .action(async function (
      this: Command,
      options: {
        node: string;
        code?: string;
        file?: string;
        stdin?: boolean;
        timeout?: string;
      },
    ) {
      const { format, workspace } = await getWorkspaceCommandOptions(
        this,
        { requireReadableCanvas: false },
      );
      const code = await readScript(options);
      const timeoutMs = parsePageEvalTimeout(options.timeout);
      const result = await callRuntimeCapability({
        workspaceId: workspace,
        name: 'browser.page.eval',
        input: {
          nodeId: options.node,
          code,
          ...(timeoutMs === undefined ? {} : { timeoutMs }),
        },
      });
      if (!result.ok) errorOutput(result.error.message, { code: result.error.code });
      output(result.value, format, renderRuntimeValue);
    });
}

function renderCapabilities(data: unknown): string {
  const capabilities = data as RuntimeCapabilityDescriptor[];
  if (capabilities.length === 0) return 'No runtime capabilities are available.';
  return capabilities
    .map((capability) => `${capability.name} [${capability.risk}] — ${capability.description}`)
    .join('\n');
}

async function readScript(options: {
  code?: string;
  file?: string;
  stdin?: boolean;
}): Promise<string> {
  const sources = [options.code !== undefined, options.file !== undefined, options.stdin === true]
    .filter(Boolean).length;
  if (sources !== 1) {
    errorOutput('Provide exactly one of --code, --file, or --stdin.', {
      code: 'invalid_argument',
    });
  }
  if (options.code !== undefined) return options.code;
  if (options.file !== undefined) {
    try {
      return await fs.readFile(options.file, 'utf8');
    } catch (error) {
      errorOutput(`Cannot read script file (${options.file}): ${String(error)}`, {
        code: 'io_error',
      });
    }
  }
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

function parsePageEvalTimeout(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > MAX_PAGE_EVAL_TIMEOUT_MS) {
    errorOutput(`Invalid --timeout: expected an integer from 1 to ${MAX_PAGE_EVAL_TIMEOUT_MS}.`, {
      code: 'invalid_argument',
    });
  }
  return parsed;
}

function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('input must be a JSON object');
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    errorOutput(`Invalid --input JSON: ${error instanceof Error ? error.message : String(error)}`, {
      code: 'invalid_argument',
    });
  }
}

function renderRuntimeValue(data: unknown): string {
  return typeof data === 'string' ? data : JSON.stringify(data, null, 2);
}
