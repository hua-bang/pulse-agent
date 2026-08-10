import type React from 'react';
import type { FileEntry } from '../shared/file-reference.js';

/** Shared Ink-host types, snapshot defaults, and composer constants. */

export type InkEventKind = 'user' | 'assistant' | 'tool' | 'result' | 'system' | 'error' | 'log';
export type InkEventStatus = 'running' | 'success' | 'error' | 'info';
// Exactly the two states the engine actually distinguishes (executing /
// planning). chat/auto existed as CLI-side skins over executing and were
// collapsed into edit; the old command names remain accepted as aliases.
export type CliInteractionMode = 'edit' | 'plan';

export const CLI_INTERACTION_MODES: CliInteractionMode[] = ['edit', 'plan'];

export interface InkRuntime {
  Box: React.ComponentType<any>;
  Text: React.ComponentType<any>;
  Static: React.ComponentType<any>;
  useApp: () => { exit: () => void };
  useInput: (handler: (input: string, key: any) => void) => void;
  usePaste?: (handler: (text: string) => void) => void;
  useStdout: () => { stdout: { rows?: number; columns?: number; on?: (event: string, handler: () => void) => void; off?: (event: string, handler: () => void) => void } };
}

export interface InkCliEvent {
  id: string;
  kind: InkEventKind;
  title?: string;
  text: string;
  status?: InkEventStatus;
  summary?: string;
}

export interface InkLiveTool {
  id: string;
  name: string;
  label: string;
}

export interface InkPickerItem {
  id: string;
  label: string;
  hint?: string;
  preview?: string;
  /** Marks the entry that is already active, so the picker can start on it. */
  isCurrent?: boolean;
}

export interface InkPickerState {
  title: string;
  items: InkPickerItem[];
}

export interface InkCliSnapshot {
  sessionId?: string | null;
  taskListId?: string | null;
  mode?: string | null;
  messages: number;
  estimatedTokens: number;
  usageInputTokens: number;
  usageOutputTokens: number;
  /** Last-step prompt-cache hits; undefined when the provider reports none. */
  usageCachedTokens?: number;
  contextWindowTokens?: number;
  /** Short display label of the active model. */
  modelLabel?: string;
  queuedInputs: number;
  isProcessing: boolean;
  status: string;
  phase?: string | null;
  activeTool?: string | null;
  toolCalls: number;
  completedTools: number;
  lastStep?: string | null;
  runStartedAt?: number | null;
  picker?: InkPickerState | null;
  /** Runtime skills, merged into the slash palette as `/<skill-name>`. */
  skills?: Array<{ name: string; description: string }>;
  /** Workspace file index backing `@` references. */
  fileIndex?: FileEntry[];
  events: InkCliEvent[];
  liveText: string;
  liveTools: InkLiveTool[];
}

export interface InkCliController {
  getSnapshot: () => InkCliSnapshot;
  submitInput: (input: string) => void | Promise<void>;
  requestStop: () => void;
  setInteractionMode?: (mode: CliInteractionMode, source?: string) => void | Promise<void>;
  toggleToolDetail?: () => void;
  toggleNarrationCollapse?: () => void;
  pickerSelect?: (id: string) => void;
  pickerCancel?: () => void;
  shutdown: () => void | Promise<void>;
  subscribe: (listener: (snapshot: InkCliSnapshot) => void) => () => void;
}

export interface InkCliAppProps {
  controller: InkCliController;
  runtime: InkRuntime;
  onExit?: () => void;
  initialHistory?: string[];
  onHistoryRecord?: (entry: string) => void;
}

export interface ComposerState {
  input: string;
  cursor: number;
}

export interface SlashCommandSuggestion {
  command: string;
  description: string;
  usage?: string;
  group: string;
}

export const DEFAULT_SNAPSHOT: InkCliSnapshot = {
  sessionId: null,
  taskListId: null,
  mode: null,
  messages: 0,
  estimatedTokens: 0,
  usageInputTokens: 0,
  usageOutputTokens: 0,
  contextWindowTokens: 0,
  queuedInputs: 0,
  isProcessing: false,
  status: 'Ready',
  phase: 'Idle',
  activeTool: null,
  toolCalls: 0,
  completedTools: 0,
  lastStep: null,
  runStartedAt: null,
  picker: null,
  skills: [],
  fileIndex: [],
  events: [],
  liveText: '',
  liveTools: [],
};

export const SLASH_COMMANDS: SlashCommandSuggestion[] = [
  { command: '/help', description: 'Show commands and shortcuts', usage: '/help', group: 'Core' },
  { command: '/new', description: 'Create a new session', usage: '/new <title?>', group: 'Session' },
  { command: '/resume', description: 'Resume a session (bare = interactive picker)', usage: '/resume [index|id-prefix]', group: 'Session' },
  { command: '/sessions', description: 'List sessions in this directory (--all for every directory)', usage: '/sessions [n] [--all]', group: 'Session' },
  { command: '/search', description: 'Search saved sessions', usage: '/search <query>', group: 'Session' },
  { command: '/rename', description: 'Rename a session', usage: '/rename <id> <title>', group: 'Session' },
  { command: '/delete', description: 'Delete a session', usage: '/delete <id>', group: 'Session' },
  { command: '/clear', description: 'Clear conversation context', usage: '/clear', group: 'Context' },
  { command: '/compact', description: 'Compact current context', usage: '/compact', group: 'Context' },
  { command: '/skills', description: 'Run a message with a selected skill', usage: '/skills <name|index> <message>', group: 'Agent' },
  { command: '/wt', description: 'Use worktree skill', usage: '/wt use <work-name>', group: 'Agent' },
  { command: '/status', description: 'Show session status', usage: '/status', group: 'Core' },
  { command: '/debug', description: 'Engine log layer: toggle, tail, status', usage: '/debug on|off|tail <n>|status', group: 'Core' },
  { command: '/model', description: 'Show or switch model (bare = picker)', usage: '/model [id|claude:<id>|reset]', group: 'Core' },
  { command: '/mode', description: 'Show or set CLI interaction mode', usage: '/mode edit|plan', group: 'Mode' },
  { command: '/plan', description: 'Switch to planning mode (engine planning)', usage: '/plan', group: 'Mode' },
  { command: '/edit', description: 'Switch to edit mode (engine executing)', usage: '/edit', group: 'Mode' },
  { command: '/save', description: 'Save current session', usage: '/save', group: 'Session' },
  { command: '/tui', description: 'Show TUI status', usage: '/tui status', group: 'Core' },
  { command: '/exit', description: 'Save and exit', usage: '/exit', group: 'Core' },
];

export const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
// Shared so the live-region row budget counts the same string that is rendered.
export const PICKER_HINT = '↑↓ select · Enter confirm · Esc cancel · type to filter';
export const MAX_HISTORY = 100;
export const CTRL_C_CONFIRM_WINDOW_MS = 2000;
// Shared so the draft window can find the row the cursor sits on.
export const CURSOR_GLYPH = '█';
