import type { TuiHelpItem } from '../shared/tui-types.js';

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
  'skills',
  'wt',
  'goal',
  'status',
  'mode',
  'chat',
  'plan',
  'edit',
  'auto',
  'execute',
  'save',
  'tui',
  'debug',
  'model',
  'narration',
  'exit',
]);

/**
 * Commands removed from the surface. The implementations still exist so the
 * capability can be brought back, but they are unreachable from the CLI: both
 * were unmaintained (raw stdout writes tearing the Ink frame, no abort
 * support) and are superseded by sub-agents.
 */
export const RETIRED_COMMANDS: Record<string, string> = {
  team: '/team is retired — use sub-agents instead.',
  teams: '/teams is retired — use sub-agents instead.',
  solo: '/solo is retired along with /teams.',
  acp: '/acp is retired — the CLI no longer proxies to external ACP agents.',
};

export const HELP_ITEMS: TuiHelpItem[] = [
  { command: '/help', description: 'Show this help message' },
  { command: '/new [title]', description: 'Create a new session' },
  { command: '/resume [index|id-prefix|id]', description: 'Resume a session (bare /resume opens an interactive picker)' },
  { command: '/sessions [n] [--all]', description: 'List recent sessions in this directory (default 20; --all for every directory)' },
  { command: '/search <query>', description: 'Search in saved sessions' },
  { command: '/rename <id> <new-title>', description: 'Rename a session' },
  { command: '/delete <id>', description: 'Delete a session' },
  { command: '/clear', description: 'Clear current conversation' },
  { command: '/compact', description: 'Force compact current conversation context' },
  { command: '/skills [list|<name|index> <message>]', description: 'Run one message with a selected skill' },
  { command: '/wt use <work-name>', description: 'Create a worktree + branch via worktree skill' },
  { command: '/goal <objective> [--verify <cmd>] [--rounds <n>]', description: 'Set a goal the agent keeps working toward; /goal status shows progress; /goal clear stops it' },
  { command: '/status', description: 'Show current CLI/session status' },
  { command: '/mode [edit|plan]', description: 'Show or set CLI interaction mode' },
  { command: '/plan', description: 'Switch to planning mode (engine planning)' },
  { command: '/edit', description: 'Switch to edit mode (engine executing); /execute, /chat, /auto are aliases' },
  { command: '/save', description: 'Save current session explicitly' },
  { command: '/tui [status]', description: 'Show current Ink UI status' },
  { command: '/debug [on|off|tail <n>]', description: 'Engine log layer: toggle live display or tail the capture' },
  { command: '/model [id|claude:<id>|reset]', description: 'Show/switch model (bare = picker from .pulse-coder/models.json)' },
  { command: '/narration [on|off]', description: 'Fold future narration segments to a one-line summary (default off); bare shows the current state' },
  { command: '/exit', description: 'Exit the application' },
];

export const HELP_FOOTER = [
  'Enter - Send current input',
  'Ctrl+J - Insert a newline into the current draft',
  'Shift+Tab - Toggle CLI interaction mode (edit ↔ plan; maps to engine executing/planning)',
  'Tab - Complete the selected slash-command suggestion',
  'Type / - Show slash-command suggestions',
  '↑/↓ - Recall previous/next prompt (persisted across sessions)',
  '←/→, Ctrl+A/E - Move cursor',
  'Ctrl+U/K/W - Delete before cursor / after cursor / previous word',
  'Ctrl+O - Toggle tool-trace detail (one-line summaries ↔ content previews; affects new traces)',
  'Ctrl+T - Toggle narration folding (/narration on|off does the same; affects new narration segments)',
  'Paste - Inserted literally (newlines included); bracketed paste supported',
  'Esc - Stop the current response, or clear the current draft when idle',
  'Ctrl+C - Press twice to save and exit (first press clears the draft)',
  'Scroll up - Finished output lives in the normal terminal scrollback',
];

/** Exported for tests only; production code goes through `createInkCoderController`. */
