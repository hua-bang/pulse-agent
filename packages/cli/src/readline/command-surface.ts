import type { TuiHelpItem } from '../shared/tui-types.js';
import type { ImageAttachment } from '../shared/file-reference.js';
import { readClipboardImage } from '../shared/clipboard-image.js';
import type { ReadlineHost } from './host-context.js';
import type { ReadlineCommands } from './host-commands.js';

export const LOCAL_COMMANDS = new Set([
  'help',
  'new',
  'resume',
  'sessions',
  'search',
  'rename',
  'delete',
  'clear',
  'compact',
  'model',
  'skills',
  'paste-image',
  'wt',
  'status',
  'mode',
  'chat',
  'plan',
  'edit',
  'auto',
  'execute',
  'save',
  'tui',
  'exit',
]);

export const HELP_ITEMS: TuiHelpItem[] = [
  { command: '/help', description: 'Show this help message' },
  { command: '/new [title]', description: 'Create a new session' },
  { command: '/resume <id>', description: 'Resume a saved session' },
  { command: '/sessions', description: 'List all saved sessions' },
  { command: '/search <query>', description: 'Search in saved sessions' },
  { command: '/rename <id> <new-title>', description: 'Rename a session' },
  { command: '/delete <id>', description: 'Delete a session' },
  { command: '/clear', description: 'Clear current conversation' },
  { command: '/compact', description: 'Force compact current conversation context' },
  { command: '/model [<spec>|reset]', description: 'Show candidates or switch the model for this session' },
  { command: '/skills [list|<name|index> <message>]', description: 'Run one message with a selected skill' },
  { command: '/paste-image [description]', description: 'Send the clipboard image as a message (Ctrl+Shift+V in Ink)' },
  { command: '/wt use <work-name>', description: 'Create a worktree + branch via worktree skill' },
  { command: '/status', description: 'Show current session status' },
  { command: '/mode', description: 'Show current plan mode' },
  { command: '/plan', description: 'Switch to planning mode' },
  { command: '/execute', description: 'Switch to executing mode' },
  { command: '/save', description: 'Save current session explicitly' },
  { command: '/tui [on|off|status]', description: 'Toggle or inspect the interactive TUI renderer' },
  { command: '/exit', description: 'Exit the application' },
];

/** Retired from the command surface; see ink-controller.ts RETIRED_COMMANDS. */
export const RETIRED_COMMANDS: Record<string, string> = {
  team: '/team is retired — use sub-agents instead.',
  teams: '/teams is retired — use sub-agents instead.',
  solo: '/solo is retired along with /teams.',
  acp: '/acp is retired — the CLI no longer proxies to external ACP agents.',
};

export const HELP_FOOTER = [
  'Esc (while processing) - Stop current response and accept next input',
  'Ctrl+C - Exit CLI immediately',
];

export type SlashRoute =
  | { kind: 'handled' }
  | { kind: 'message'; message: string; images?: ImageAttachment[] };

/**
 * Routes a `/`-prefixed input line: retired notices, built-in commands
 * (built-in > skill > error, same order as the Ink host), and the skill/wt
 * transforms that turn a command into a model message. 'handled' means the
 * route already printed its outcome; 'message' feeds the agent run.
 */
export async function routeSlashInput(
  host: ReadlineHost,
  commands: ReadlineCommands,
  trimmedInput: string,
): Promise<SlashRoute> {
  if (trimmedInput.startsWith('//')) {
    host.tui.warn(`${RETIRED_COMMANDS.acp} The "//" ACP passthrough prefix is retired with it.`);
    return { kind: 'handled' };
  }

  let messageInput = trimmedInput;
  const commandLine = messageInput.substring(1);
  const parts = commandLine.split(/\s+/).filter(part => part.length > 0);

  if (parts.length === 0) {
    host.tui.warn('Please provide a command after "/"');
    return { kind: 'handled' };
  }

  const command = parts[0];
  const args = parts.slice(1);
  const normalizedCommand = command.toLowerCase();

  const retiredNotice = RETIRED_COMMANDS[normalizedCommand];
  if (retiredNotice) {
    host.tui.warn(retiredNotice);
    return { kind: 'handled' };
  }

  if (!LOCAL_COMMANDS.has(normalizedCommand)) {
    // built-in > skill > error (same order as the Ink host).
    const skill = host.skillCommands.findSkill(command);
    const skillMessage = args.join(' ').trim();
    if (skill && skillMessage) {
      messageInput = `[use skill](${skill.name}) ${skillMessage}`;
    } else {
      if (skill) {
        host.tui.error(`Usage: /${skill.name} <message>`);
      } else {
        host.tui.warn(`Unknown command: /${command}`);
        host.tui.info('Type /help for commands, /skills list for skills');
      }
      return { kind: 'handled' };
    }
  }

  if (normalizedCommand === 'skills') {
    const transformedMessage = await host.skillCommands.transformSkillsCommandToMessage(args);
    if (!transformedMessage) {
      return { kind: 'handled' };
    }

    return { kind: 'message', message: transformedMessage };
  }

  if (normalizedCommand === 'paste-image') {
    const description = args.join(' ').trim();
    try {
      const pasted = await readClipboardImage();
      if (!pasted) {
        host.tui.warn('Clipboard does not contain an image. Copy a screenshot first (Cmd+Shift+4), then retry.');
        return { kind: 'handled' };
      }
      const text = description || '(pasted image)';
      return {
        kind: 'message',
        message: text,
        images: [{ ref: '(clipboard)', mimeType: pasted.mimeType, dataUrl: pasted.dataUrl }],
      };
    } catch (error) {
      host.tui.error(`Failed to read clipboard image: ${error instanceof Error ? error.message : String(error)}`);
      return { kind: 'handled' };
    }
  }

  if (normalizedCommand === 'wt') {
    if (args.length < 2 || args[0].toLowerCase() !== 'use') {
      host.tui.error('Usage: /wt use <work-name>');
      return { kind: 'handled' };
    }

    const workName = args.slice(1).join(' ').trim();
    if (!workName) {
      host.tui.error('Worktree name cannot be empty.');
      host.tui.info('Usage: /wt use <work-name>');
      return { kind: 'handled' };
    }

    host.tui.success('Worktree request prepared via skill: worktree');
    return { kind: 'message', message: `[use skill](worktree) new ${workName}` };
  }

  // NOTE: a transformed non-local skill message also lands here and is passed
  // to handleCommand (which reports it as unknown) — preserved as-is from the
  // pre-split host; see host AGENTS notes before changing.
  await commands.handleCommand(command, args);
  return { kind: 'handled' };
}
