import { startCommand } from './launch.mjs';
import { screenshotCommand } from './screenshot.mjs';
import { perfRuntimeCommand } from './perf.mjs';
import { HarnessError } from './errors.mjs';
import {
  clickCommand,
  closeCommand,
  evalRendererCommand,
  fillCommand,
  logsCommand,
  onboardCommand,
  pressCommand,
  snapshotUiCommand,
  statusCommand,
} from './commands.mjs';

export const HELP = `
Pulse Canvas harness

Usage:
  pnpm --filter canvas-workspace harness start [--profile temp|demo|clone|real] [options]
  pnpm --filter canvas-workspace harness status [--json]
  pnpm --filter canvas-workspace harness onboard
  pnpm --filter canvas-workspace harness screenshot [--output path.png] [--method auto|system|cdp]
  pnpm --filter canvas-workspace harness snapshot-ui [--json]
  pnpm --filter canvas-workspace harness eval-renderer <expression>
  pnpm --filter canvas-workspace harness click --selector <css>
  pnpm --filter canvas-workspace harness click --text <text>
  pnpm --filter canvas-workspace harness click --xy <x,y>
  pnpm --filter canvas-workspace harness fill --selector <css> <text>
  pnpm --filter canvas-workspace harness press <key-or-combo>
  pnpm --filter canvas-workspace harness logs [--lines 80]
  pnpm --filter canvas-workspace harness perf-runtime [--scenario all|idle|pan-zoom] [--duration 4000]
                                [--start] [--keep] [--build] [--profile demo] [--json]
  pnpm --filter canvas-workspace harness close [--cleanup]

Start options:
  --profile <name>              temp (default), demo, clone, or real
  --workspace <id>              workspace id for clone/real metadata
  --build                       run pnpm run build before launching
  --force                       close an existing harness session first
  --reset                       reset demo HOME before launch
  --allow-real-writes           required for profile=real
  --target <name>               open startup target: onboard
  --route <hash-route>          open a hash route, e.g. '/chat'
  --flag <id>                   enable an experimental flag, repeatable
  --enable-webview-page-control shortcut for --flag webview-page-control
  --json                        print machine-readable output
`;

export async function main(args) {
  const [command = 'help', ...rawArgs] = args;
  try {
    switch (command) {
      case 'help':
      case '--help':
      case '-h':
        process.stdout.write(HELP);
        break;
      case 'start':
        await startCommand(rawArgs);
        break;
      case 'status':
        await statusCommand(rawArgs);
        break;
      case 'onboard':
      case 'open-onboard':
        await onboardCommand(rawArgs);
        break;
      case 'screenshot':
        await screenshotCommand(rawArgs);
        break;
      case 'snapshot-ui':
        await snapshotUiCommand(rawArgs);
        break;
      case 'eval-renderer':
      case 'eval':
        await evalRendererCommand(rawArgs);
        break;
      case 'click':
        await clickCommand(rawArgs);
        break;
      case 'fill':
        await fillCommand(rawArgs);
        break;
      case 'press':
        await pressCommand(rawArgs);
        break;
      case 'logs':
        await logsCommand(rawArgs);
        break;
      case 'perf-runtime':
        await perfRuntimeCommand(rawArgs);
        break;
      case 'close':
      case 'stop':
        await closeCommand(rawArgs);
        break;
      default:
        throw new HarnessError(`Unknown harness command: ${command}\n${HELP}`);
    }
  } catch (err) {
    if (err instanceof HarnessError) {
      console.error(err.message);
      process.exit(err.code);
    }
    console.error(err instanceof Error ? err.stack ?? err.message : String(err));
    process.exit(1);
  }
}
