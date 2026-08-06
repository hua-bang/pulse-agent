import React, { useEffect, useMemo, useRef, useState } from 'react';

import { renderMarkdownAnsi } from './markdown.js';

export type InkEventKind = 'user' | 'assistant' | 'tool' | 'result' | 'system' | 'error' | 'log';
export type InkEventStatus = 'running' | 'success' | 'error' | 'info';
// Exactly the two states the engine actually distinguishes (executing /
// planning). chat/auto existed as CLI-side skins over executing and were
// collapsed into edit; the old command names remain accepted as aliases.
export type CliInteractionMode = 'edit' | 'plan';

const CLI_INTERACTION_MODES: CliInteractionMode[] = ['edit', 'plan'];

interface InkRuntime {
  Box: React.ComponentType<any>;
  Text: React.ComponentType<any>;
  Static: React.ComponentType<any>;
  useApp: () => { exit: () => void };
  useInput: (handler: (input: string, key: any) => void) => void;
  usePaste?: (handler: (text: string) => void) => void;
  useStdout: () => { stdout: { rows?: number } };
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

export interface InkCliSnapshot {
  sessionId?: string | null;
  taskListId?: string | null;
  mode?: string | null;
  messages: number;
  estimatedTokens: number;
  usageInputTokens: number;
  usageOutputTokens: number;
  contextWindowTokens?: number;
  queuedInputs: number;
  isProcessing: boolean;
  status: string;
  phase?: string | null;
  activeTool?: string | null;
  toolCalls: number;
  completedTools: number;
  lastStep?: string | null;
  runStartedAt?: number | null;
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
  shutdown: () => void | Promise<void>;
  subscribe: (listener: (snapshot: InkCliSnapshot) => void) => () => void;
}

interface InkCliAppProps {
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

const DEFAULT_SNAPSHOT: InkCliSnapshot = {
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
  events: [],
  liveText: '',
  liveTools: [],
};

const SLASH_COMMANDS: SlashCommandSuggestion[] = [
  { command: '/help', description: 'Show commands and shortcuts', usage: '/help', group: 'Core' },
  { command: '/new', description: 'Create a new session', usage: '/new <title?>', group: 'Session' },
  { command: '/resume', description: 'Resume a saved session', usage: '/resume <index|id-prefix>', group: 'Session' },
  { command: '/sessions', description: 'List saved sessions', usage: '/sessions', group: 'Session' },
  { command: '/search', description: 'Search saved sessions', usage: '/search <query>', group: 'Session' },
  { command: '/rename', description: 'Rename a session', usage: '/rename <id> <title>', group: 'Session' },
  { command: '/delete', description: 'Delete a session', usage: '/delete <id>', group: 'Session' },
  { command: '/clear', description: 'Clear conversation context', usage: '/clear', group: 'Context' },
  { command: '/compact', description: 'Compact current context', usage: '/compact', group: 'Context' },
  { command: '/skills', description: 'Run a message with a selected skill', usage: '/skills <name|index> <message>', group: 'Agent' },
  { command: '/acp', description: 'Manage ACP mode', usage: '/acp status|on|off|cd', group: 'Agent' },
  { command: '/wt', description: 'Use worktree skill', usage: '/wt use <work-name>', group: 'Agent' },
  { command: '/status', description: 'Show session status', usage: '/status', group: 'Core' },
  { command: '/debug', description: 'Engine log layer: toggle, tail, status', usage: '/debug on|off|tail <n>|status', group: 'Core' },
  { command: '/mode', description: 'Show or set CLI interaction mode', usage: '/mode edit|plan', group: 'Mode' },
  { command: '/plan', description: 'Switch to planning mode (engine planning)', usage: '/plan', group: 'Mode' },
  { command: '/edit', description: 'Switch to edit mode (engine executing)', usage: '/edit', group: 'Mode' },
  { command: '/team', description: 'Run a multi-agent team', usage: '/team <task>', group: 'Teams' },
  { command: '/teams', description: 'Enter teams mode', usage: '/teams <task>', group: 'Teams' },
  { command: '/solo', description: 'Exit teams mode', usage: '/solo', group: 'Teams' },
  { command: '/save', description: 'Save current session', usage: '/save', group: 'Session' },
  { command: '/tui', description: 'Show TUI status', usage: '/tui status', group: 'Core' },
  { command: '/exit', description: 'Save and exit', usage: '/exit', group: 'Core' },
];

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const MAX_HISTORY = 100;
const CTRL_C_CONFIRM_WINDOW_MS = 2000;

export function insertAtCursor(state: ComposerState, value: string): ComposerState {
  const cursor = clampCursor(state.input, state.cursor);
  return {
    input: `${state.input.slice(0, cursor)}${value}${state.input.slice(cursor)}`,
    cursor: cursor + value.length,
  };
}

export function removeBeforeCursor(state: ComposerState): ComposerState {
  const cursor = clampCursor(state.input, state.cursor);
  if (cursor === 0) {
    return { input: state.input, cursor };
  }

  return {
    input: `${state.input.slice(0, cursor - 1)}${state.input.slice(cursor)}`,
    cursor: cursor - 1,
  };
}

export function removeAtCursor(state: ComposerState): ComposerState {
  const cursor = clampCursor(state.input, state.cursor);
  if (cursor >= state.input.length) {
    return { input: state.input, cursor };
  }

  return {
    input: `${state.input.slice(0, cursor)}${state.input.slice(cursor + 1)}`,
    cursor,
  };
}

export function removeWordBeforeCursor(state: ComposerState): ComposerState {
  const cursor = clampCursor(state.input, state.cursor);
  if (cursor === 0) {
    return { input: state.input, cursor };
  }

  const beforeCursor = state.input.slice(0, cursor);
  const afterCursor = state.input.slice(cursor);
  const wordStart = beforeCursor.replace(/\s+$/, '').search(/\S+$/);
  const deleteFrom = wordStart === -1 ? 0 : wordStart;
  return {
    input: `${beforeCursor.slice(0, deleteFrom)}${afterCursor}`,
    cursor: deleteFrom,
  };
}

export function renderPrompt(input: string, cursor: number, cursorVisible: boolean): string {
  return renderPromptLines(input, cursor, cursorVisible).join('\n');
}

export function renderPromptLines(input: string, cursor: number, cursorVisible: boolean): string[] {
  const normalizedCursor = clampCursor(input, cursor);
  const cursorGlyph = cursorVisible ? '█' : ' ';
  return `${input.slice(0, normalizedCursor)}${cursorGlyph}${input.slice(normalizedCursor)}`.split('\n');
}

/**
 * Multi-character `useInput` values only occur when the terminal delivered a
 * chunk (non-bracketed paste or coalesced typing). Those must be inserted
 * literally — never interpreted as Enter/Tab — or a paste containing a
 * newline would submit the draft mid-paste.
 */
export function isPasteChunk(value: string): boolean {
  return typeof value === 'string' && value.length > 1;
}

export function normalizePastedText(value: string): string {
  return value.replace(/\x1b\[20[01]~/g, '').replace(/\r\n?/g, '\n');
}

export function getSlashCommandSuggestions(input: string, cursor: number, limit = 6): SlashCommandSuggestion[] {
  const normalizedCursor = clampCursor(input, cursor);
  const beforeCursor = input.slice(0, normalizedCursor);
  if (!beforeCursor.startsWith('/') || beforeCursor.startsWith('//') || beforeCursor.includes('\n')) {
    return [];
  }

  const match = beforeCursor.match(/^\/([^\s/]*)$/);
  if (!match) {
    return [];
  }

  const query = match[1].toLowerCase();
  return SLASH_COMMANDS
    .map((item, index) => ({ item, index, score: scoreSlashCommand(item.command.slice(1), query) }))
    .filter(match => match.score >= 0)
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map(match => match.item)
    .slice(0, limit);
}

export function shouldAcceptSlashSuggestion(input: string, cursor: number, suggestion?: SlashCommandSuggestion): boolean {
  if (!suggestion) {
    return false;
  }

  const normalizedCursor = clampCursor(input, cursor);
  const beforeCursor = input.slice(0, normalizedCursor);
  const match = beforeCursor.match(/^\/([^\s/]*)$/);
  if (!match) {
    return false;
  }

  return beforeCursor !== suggestion.command;
}

function scoreSlashCommand(commandName: string, query: string): number {
  if (query.length === 0) {
    return 0;
  }
  if (commandName.startsWith(query)) {
    return 0;
  }
  const containsIndex = commandName.indexOf(query);
  if (containsIndex >= 0) {
    return 100 + containsIndex;
  }
  if (isSubsequence(query, commandName)) {
    return 200 + commandName.length;
  }
  return -1;
}

function isSubsequence(query: string, value: string): boolean {
  let queryIndex = 0;
  for (const char of value) {
    if (char === query[queryIndex]) {
      queryIndex += 1;
      if (queryIndex === query.length) {
        return true;
      }
    }
  }
  return query.length === 0;
}

export function applySlashCommandCompletion(input: string, cursor: number, command: string): ComposerState {
  const normalizedCursor = clampCursor(input, cursor);
  const beforeCursor = input.slice(0, normalizedCursor);
  if (!beforeCursor.match(/^\/([^\s/]*)$/)) {
    return { input, cursor: normalizedCursor };
  }

  const suffix = input.slice(normalizedCursor);
  const completed = `${command} `;
  return {
    input: `${completed}${suffix}`,
    cursor: completed.length,
  };
}

export function nextInteractionMode(mode: string | null | undefined): CliInteractionMode {
  const currentIndex = CLI_INTERACTION_MODES.indexOf(normalizeInteractionMode(mode));
  return CLI_INTERACTION_MODES[(currentIndex + 1) % CLI_INTERACTION_MODES.length];
}

export function normalizeInteractionMode(mode: string | null | undefined): CliInteractionMode {
  if (mode === 'plan' || mode === 'planning') {
    return 'plan';
  }
  return 'edit';
}

export function formatTokenCount(tokens: number): string {
  if (tokens < 1000) {
    return `${tokens}`;
  }
  if (tokens < 10000) {
    return `${(tokens / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  }
  return `${Math.round(tokens / 1000)}k`;
}

export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m${String(seconds % 60).padStart(2, '0')}s`;
}

export function formatStatusline(snapshot: InkCliSnapshot): string {
  const mode = normalizeInteractionMode(snapshot.mode);
  const contextTokens = snapshot.usageInputTokens > 0 ? snapshot.usageInputTokens : snapshot.estimatedTokens;
  const window = snapshot.contextWindowTokens ?? 0;
  const contextPct = window > 0 && contextTokens > 0 ? ` (${Math.min(999, Math.round(contextTokens / window * 100))}%)` : '';
  const parts = [
    `mode ${mode}`,
    `ctx ~${formatTokenCount(contextTokens)}${contextPct}`,
    snapshot.usageOutputTokens > 0 ? `out ~${formatTokenCount(snapshot.usageOutputTokens)}` : null,
    snapshot.activeTool ? `active ${snapshot.activeTool}` : null,
    snapshot.toolCalls > 0 ? `tools ${snapshot.completedTools}/${snapshot.toolCalls}` : null,
    snapshot.queuedInputs > 0 ? `queue ${snapshot.queuedInputs}` : null,
    `session ${snapshot.sessionId ? snapshot.sessionId.slice(0, 8) : 'new'}`,
  ].filter((part): part is string => Boolean(part));
  return parts.join(' · ');
}

export function describeInteractionMode(mode: CliInteractionMode): string {
  switch (mode) {
    case 'plan':
      return 'engine plan mode: inspect and plan before changes';
    case 'edit':
      return 'engine execute mode: implement and validate';
  }
}

function clampCursor(input: string, cursor: number): number {
  return Math.max(0, Math.min(input.length, cursor));
}

function normalizeInputValue(value: string): string {
  return value.replace(/\r\n?/g, '\n');
}

function recordHistory(history: string[], submitted: string): string[] {
  const trimmed = submitted.trim();
  if (!trimmed || history[history.length - 1] === trimmed) {
    return history;
  }

  return [...history, trimmed].slice(-MAX_HISTORY);
}

function TranscriptEvent({ event, Box, Text }: { event: InkCliEvent; Box: React.ComponentType<any>; Text: React.ComponentType<any> }) {
  if (event.kind === 'log') {
    return <Text color="gray" dimColor>{event.text}</Text>;
  }

  if (event.kind === 'tool') {
    // Tool traces are secondary: everything gray, a hint of color on the icon
    // only. Failures are the exception — they stay bright red.
    const isError = event.status === 'error';
    const icon = isError ? '✕' : event.status === 'info' ? '·' : '✓';
    const previewLines = event.text ? event.text.split('\n') : [];
    return (
      <Box flexDirection="column">
        <Text>
          {isError
            ? <Text color="red">{icon} </Text>
            : <Text color={event.status === 'info' ? 'gray' : 'green'} dimColor>{icon} </Text>}
          <Text color={isError ? 'red' : 'gray'}>{event.title ?? 'tool'}</Text>
        </Text>
        {previewLines.map((line, index) => (
          <Text key={index} color="gray" dimColor>  {index === 0 ? '⎿ ' : '  '}{line}</Text>
        ))}
      </Box>
    );
  }

  if (event.kind === 'user') {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text color="cyan">› <Text color="white">{event.text}</Text></Text>
      </Box>
    );
  }

  if (event.kind === 'assistant') {
    // Narration between tool calls (status: 'info') sits at the tool-trace
    // layer; only the answer segment that ends a run renders bright.
    if (event.status === 'info') {
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text color="gray">{event.text}</Text>
        </Box>
      );
    }
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text>{renderMarkdownAnsi(event.text)}</Text>
      </Box>
    );
  }

  if (event.kind === 'error') {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text color="red">{event.title ? `${event.title} · ` : ''}{event.text}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      {event.title ? <Text bold color="blue">{event.title}</Text> : null}
      <Text color="gray">{event.text}</Text>
    </Box>
  );
}

export function InkCliApp({ controller, runtime, onExit, initialHistory, onHistoryRecord }: InkCliAppProps) {
  const { Box, Text, Static, useApp, useInput, usePaste, useStdout } = runtime;
  const [snapshot, setSnapshot] = useState<InkCliSnapshot>(() => ({
    ...DEFAULT_SNAPSHOT,
    ...controller.getSnapshot(),
  }));
  const [input, setInput] = useState('');
  const [cursor, setCursor] = useState(0);
  const [history, setHistory] = useState<string[]>(() => (initialHistory ?? []).slice(-MAX_HISTORY));
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const [historyDraft, setHistoryDraft] = useState('');
  const [spinnerIndex, setSpinnerIndex] = useState(0);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);
  const [ctrlCArmed, setCtrlCArmed] = useState(false);
  const ctrlCTimer = useRef<NodeJS.Timeout | null>(null);
  const app = useApp();
  const { stdout } = useStdout();
  const currentInteractionMode = normalizeInteractionMode(snapshot.mode);

  useEffect(() => controller.subscribe(setSnapshot), [controller]);

  useEffect(() => {
    if (!snapshot.isProcessing) {
      return;
    }

    const timer = setInterval(() => setSpinnerIndex(current => current + 1), 120);
    return () => clearInterval(timer);
  }, [snapshot.isProcessing]);

  useEffect(() => () => {
    if (ctrlCTimer.current) {
      clearTimeout(ctrlCTimer.current);
    }
  }, []);

  const updateComposer = (next: ComposerState) => {
    setInput(next.input);
    setCursor(clampCursor(next.input, next.cursor));
    setHistoryIndex(null);
  };

  const replaceComposer = (nextInput: string) => {
    setInput(nextInput);
    setCursor(nextInput.length);
  };

  const disarmCtrlC = () => {
    if (ctrlCTimer.current) {
      clearTimeout(ctrlCTimer.current);
      ctrlCTimer.current = null;
    }
    setCtrlCArmed(false);
  };

  const exitApp = () => {
    void controller.shutdown();
    onExit?.();
    app.exit();
  };

  const submitCurrentInput = () => {
    const submitted = input;
    setInput('');
    setCursor(0);
    setHistory(current => recordHistory(current, submitted));
    if (submitted.trim()) {
      onHistoryRecord?.(submitted.trim());
    }
    setHistoryIndex(null);
    setHistoryDraft('');

    void (async () => {
      await controller.submitInput(submitted);
      const normalized = submitted.trim().toLowerCase();
      if (normalized === 'exit' || normalized === '/exit') {
        onExit?.();
        app.exit();
      }
    })();
  };

  const showPreviousHistory = () => {
    if (history.length === 0) {
      return;
    }

    if (historyIndex === null) {
      setHistoryDraft(input);
      setHistoryIndex(history.length - 1);
      replaceComposer(history[history.length - 1]);
      return;
    }

    const nextIndex = Math.max(0, historyIndex - 1);
    setHistoryIndex(nextIndex);
    replaceComposer(history[nextIndex]);
  };

  const showNextHistory = () => {
    if (historyIndex === null) {
      return;
    }

    const nextIndex = historyIndex + 1;
    if (nextIndex >= history.length) {
      setHistoryIndex(null);
      replaceComposer(historyDraft);
      setHistoryDraft('');
      return;
    }

    setHistoryIndex(nextIndex);
    replaceComposer(history[nextIndex]);
  };

  const cycleInteractionMode = () => {
    const nextMode = nextInteractionMode(currentInteractionMode);
    void controller.setInteractionMode?.(nextMode, 'shortcut:shift-tab');
  };

  const insertPastedText = (text: string) => {
    const normalized = normalizePastedText(text);
    if (!normalized) {
      return;
    }
    updateComposer(insertAtCursor({ input, cursor }, normalized));
  };

  usePaste?.(insertPastedText);

  useInput((value, key) => {
    if (key.ctrl && value === 'c') {
      if (ctrlCArmed) {
        disarmCtrlC();
        exitApp();
        return;
      }

      if (input.length > 0) {
        setInput('');
        setCursor(0);
        setHistoryIndex(null);
        setHistoryDraft('');
      }
      setCtrlCArmed(true);
      ctrlCTimer.current = setTimeout(() => {
        ctrlCTimer.current = null;
        setCtrlCArmed(false);
      }, CTRL_C_CONFIRM_WINDOW_MS);
      return;
    }

    disarmCtrlC();

    // Chunked input (paste on terminals without bracketed paste, coalesced
    // typing) must be inserted literally before any key interpretation.
    if (isPasteChunk(value) && !key.ctrl && !key.meta) {
      insertPastedText(value);
      return;
    }

    if (key.escape) {
      if (snapshot.isProcessing) {
        controller.requestStop();
        return;
      }

      if (input.length > 0) {
        setInput('');
        setCursor(0);
        setHistoryIndex(null);
        setHistoryDraft('');
      }
      return;
    }

    if (key.shift && (key.tab || value === '\t')) {
      cycleInteractionMode();
      return;
    }

    if (key.tab || value === '\t') {
      if (selectedSuggestion) {
        updateComposer(applySlashCommandCompletion(input, cursor, selectedSuggestion.command));
      }
      return;
    }

    if (key.ctrl && value === 'o') {
      controller.toggleToolDetail?.();
      return;
    }

    if (key.ctrl && (value === 'j' || value === '\n')) {
      updateComposer(insertAtCursor({ input, cursor }, '\n'));
      return;
    }

    if (key.return) {
      if (shouldAcceptSlashSuggestion(input, cursor, selectedSuggestion)) {
        updateComposer(applySlashCommandCompletion(input, cursor, selectedSuggestion.command));
        return;
      }
      submitCurrentInput();
      return;
    }

    if (key.upArrow) {
      if (slashSuggestions.length > 0) {
        setSelectedSuggestionIndex(current => Math.max(0, current - 1));
        return;
      }
      showPreviousHistory();
      return;
    }

    if (key.downArrow) {
      if (slashSuggestions.length > 0) {
        setSelectedSuggestionIndex(current => Math.min(slashSuggestions.length - 1, current + 1));
        return;
      }
      showNextHistory();
      return;
    }

    if (key.leftArrow) {
      setCursor(current => Math.max(0, current - 1));
      setHistoryIndex(null);
      return;
    }

    if (key.rightArrow) {
      setCursor(current => Math.min(input.length, current + 1));
      setHistoryIndex(null);
      return;
    }

    if (key.ctrl && value === 'a') {
      setCursor(0);
      setHistoryIndex(null);
      return;
    }

    if (key.ctrl && value === 'e') {
      setCursor(input.length);
      setHistoryIndex(null);
      return;
    }

    if (key.ctrl && value === 'u') {
      updateComposer({ input: input.slice(cursor), cursor: 0 });
      return;
    }

    if (key.ctrl && value === 'k') {
      updateComposer({ input: input.slice(0, cursor), cursor });
      return;
    }

    if (key.ctrl && value === 'w') {
      updateComposer(removeWordBeforeCursor({ input, cursor }));
      return;
    }

    if (key.backspace) {
      updateComposer(removeBeforeCursor({ input, cursor }));
      return;
    }

    if (key.delete) {
      updateComposer(removeAtCursor({ input, cursor }));
      return;
    }

    if (value && !key.ctrl && !key.meta) {
      updateComposer(insertAtCursor({ input, cursor }, normalizeInputValue(value)));
    }
  });

  const terminalRows = stdout.rows ?? 30;
  const spinner = SPINNER_FRAMES[spinnerIndex % SPINNER_FRAMES.length];
  const promptLines = useMemo(() => renderPromptLines(input, cursor, true), [cursor, input]);
  const slashSuggestions = useMemo(() => getSlashCommandSuggestions(input, cursor), [cursor, input]);
  const normalizedSuggestionIndex = Math.min(selectedSuggestionIndex, Math.max(0, slashSuggestions.length - 1));
  const selectedSuggestion = slashSuggestions[normalizedSuggestionIndex];
  useEffect(() => {
    setSelectedSuggestionIndex(current => Math.min(current, Math.max(0, slashSuggestions.length - 1)));
  }, [slashSuggestions.length]);

  const maxPromptLines = Math.max(1, Math.min(6, terminalRows - 10));
  const visiblePromptLines = promptLines.slice(-maxPromptLines);
  const hiddenPromptLineCount = promptLines.length - visiblePromptLines.length;
  const waitingClarification = snapshot.phase === 'Clarification';
  const keyHint = ctrlCArmed
    ? 'Press Ctrl+C again to exit'
    : waitingClarification
      ? 'Clarification · Enter submit answer · Esc cancel'
      : snapshot.isProcessing
        ? 'Esc stop · Enter queues draft · Shift+Tab mode'
        : slashSuggestions.length > 0
          ? '↑↓ select · Tab/Enter complete · Esc clear'
          : input.length > 0
            ? 'Enter send · Ctrl+J newline · Esc clear'
            : `/ commands · ↑↓ history · Ctrl+O detail · Shift+Tab mode (${currentInteractionMode}: ${describeInteractionMode(currentInteractionMode)})`;
  const composerColor = waitingClarification ? 'magenta' : snapshot.isProcessing ? 'yellow' : 'cyan';
  const statusIcon = snapshot.isProcessing ? spinner : '●';
  const statusColor = snapshot.isProcessing ? 'yellow' : snapshot.status === 'Cancelled' ? 'red' : 'green';

  return (
    <Box flexDirection="column">
      <Static items={snapshot.events}>
        {(event: InkCliEvent) => <TranscriptEvent key={event.id} event={event} Box={Box} Text={Text} />}
      </Static>

      {snapshot.liveText ? (
        <Box flexDirection="column" marginTop={1}>
          <Text>{renderMarkdownAnsi(snapshot.liveText)}</Text>
        </Box>
      ) : null}

      {snapshot.liveTools.map(tool => (
        <Text key={tool.id}>
          <Text color="yellow" dimColor>{spinner} </Text>
          <Text color="gray">{tool.label}</Text>
        </Text>
      ))}

      <Box marginTop={1}>
        <Text color={statusColor}>{statusIcon} {snapshot.status}{snapshot.isProcessing && snapshot.runStartedAt ? ` · ${formatElapsed(Date.now() - snapshot.runStartedAt)}` : ''}</Text>
        <Text color="gray"> · {formatStatusline(snapshot)}</Text>
      </Box>

      <Box borderStyle="round" borderColor={composerColor} paddingX={1} flexDirection="column">
        {hiddenPromptLineCount > 0 ? <Text color="gray">… {hiddenPromptLineCount} earlier draft line{hiddenPromptLineCount === 1 ? '' : 's'}</Text> : null}
        {visiblePromptLines.map((line, index) => (
          <Text key={`${index}-${line}`} color="cyan">
            {index === 0 ? '› ' : '  '}<Text color="white">{line || ' '}</Text>
          </Text>
        ))}
      </Box>

      {slashSuggestions.length > 0 ? (
        <Box flexDirection="column">
          {slashSuggestions.map((suggestion, index) => (
            <Text key={suggestion.command} color={index === normalizedSuggestionIndex ? 'yellow' : 'gray'}>
              {index === normalizedSuggestionIndex ? '→ ' : '  '}{suggestion.command}  <Text color="gray">{suggestion.description}{index === normalizedSuggestionIndex && suggestion.usage ? ` · ${suggestion.usage}` : ''}</Text>
            </Text>
          ))}
        </Box>
      ) : null}

      <Text color="gray">{keyHint}</Text>
    </Box>
  );
}
