import React, { useEffect, useMemo, useState } from 'react';

export type InkEventKind = 'user' | 'assistant' | 'tool' | 'result' | 'system' | 'error';
export type InkEventStatus = 'running' | 'success' | 'error' | 'info';
export type CliInteractionMode = 'chat' | 'plan' | 'edit' | 'auto';

const CLI_INTERACTION_MODES: CliInteractionMode[] = ['chat', 'plan', 'edit', 'auto'];

interface InkRuntime {
  Box: React.ComponentType<any>;
  Text: React.ComponentType<any>;
  useApp: () => { exit: () => void };
  useInput: (handler: (input: string, key: any) => void) => void;
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

export interface InkCliSnapshot {
  sessionId?: string | null;
  taskListId?: string | null;
  mode?: string | null;
  messages: number;
  estimatedTokens: number;
  queuedInputs: number;
  isProcessing: boolean;
  status: string;
  phase?: string | null;
  activeTool?: string | null;
  toolCalls: number;
  completedTools: number;
  lastStep?: string | null;
  events: InkCliEvent[];
}

export interface InkCliController {
  getSnapshot: () => InkCliSnapshot;
  submitInput: (input: string) => void | Promise<void>;
  requestStop: () => void;
  setInteractionMode?: (mode: CliInteractionMode, source?: string) => void | Promise<void>;
  shutdown: () => void | Promise<void>;
  subscribe: (listener: (snapshot: InkCliSnapshot) => void) => () => void;
}

interface InkCliAppProps {
  controller: InkCliController;
  runtime: InkRuntime;
  onExit?: () => void;
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
  queuedInputs: 0,
  isProcessing: false,
  status: 'Ready',
  phase: 'Idle',
  activeTool: null,
  toolCalls: 0,
  completedTools: 0,
  lastStep: null,
  events: [],
};

const KIND_LABEL: Record<InkEventKind, string> = {
  user: 'You',
  assistant: 'Assistant',
  tool: 'Tool',
  result: 'Result',
  system: 'System',
  error: 'Error',
};

const KIND_COLOR: Record<InkEventKind, string> = {
  user: 'cyan',
  assistant: 'green',
  tool: 'magenta',
  result: 'green',
  system: 'blue',
  error: 'red',
};

const EVENT_STATUS_ICON: Record<InkEventStatus, string> = {
  running: '⏳',
  success: '✓',
  error: '✕',
  info: '•',
};

const EVENT_STATUS_COLOR: Record<InkEventStatus, string> = {
  running: 'yellow',
  success: 'green',
  error: 'red',
  info: 'blue',
};

const SLASH_COMMANDS: SlashCommandSuggestion[] = [
  { command: '/help', description: 'Show commands and shortcuts', usage: '/help', group: 'Core' },
  { command: '/new', description: 'Create a new session', usage: '/new <title?>', group: 'Session' },
  { command: '/resume', description: 'Resume a saved session', usage: '/resume <session-id>', group: 'Session' },
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
  { command: '/mode', description: 'Show or set CLI interaction mode', usage: '/mode chat|plan|edit|auto', group: 'Mode' },
  { command: '/chat', description: 'Switch to chat interaction mode', usage: '/chat', group: 'Mode' },
  { command: '/plan', description: 'Switch to planning interaction mode', usage: '/plan', group: 'Mode' },
  { command: '/edit', description: 'Switch to edit interaction mode', usage: '/edit', group: 'Mode' },
  { command: '/auto', description: 'Switch to autonomous interaction mode', usage: '/auto', group: 'Mode' },
  { command: '/execute', description: 'Alias for /edit', usage: '/execute', group: 'Mode' },
  { command: '/team', description: 'Run a multi-agent team', usage: '/team <task>', group: 'Teams' },
  { command: '/teams', description: 'Enter teams mode', usage: '/teams <task>', group: 'Teams' },
  { command: '/solo', description: 'Exit teams mode', usage: '/solo', group: 'Teams' },
  { command: '/save', description: 'Save current session', usage: '/save', group: 'Session' },
  { command: '/tui', description: 'Show TUI status', usage: '/tui status', group: 'Core' },
  { command: '/exit', description: 'Save and exit', usage: '/exit', group: 'Core' },
];

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const MAX_HISTORY = 100;

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
  if (mode === 'chat' || mode === 'plan' || mode === 'edit' || mode === 'auto') {
    return mode;
  }
  if (mode === 'planning') {
    return 'plan';
  }
  if (mode === 'executing') {
    return 'edit';
  }
  return 'chat';
}

export function formatStatusline(snapshot: InkCliSnapshot): string {
  const mode = normalizeInteractionMode(snapshot.mode);
  const phase = snapshot.phase ?? (snapshot.isProcessing ? 'Running' : 'Idle');
  const active = snapshot.activeTool ? ` · active ${snapshot.activeTool}` : '';
  const tools = `${snapshot.completedTools}/${snapshot.toolCalls}`;
  const queue = snapshot.queuedInputs > 0 ? ` · queue ${snapshot.queuedInputs}` : '';
  const session = snapshot.sessionId ?? 'new';
  return `Pulse Coder · mode ${mode} · phase ${phase}${active} · tools ${tools}${queue} · session ${session}`;
}

export function describeInteractionMode(mode: CliInteractionMode): string {
  switch (mode) {
    case 'chat':
      return 'free-form conversation; no extra CLI-side constraints';
    case 'plan':
      return 'ask for inspection and a plan before changes';
    case 'edit':
      return 'optimize for implementation and validation';
    case 'auto':
      return 'optimize for low-interaction autonomous execution';
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

export function InkCliApp({ controller, runtime, onExit }: InkCliAppProps) {
  const { Box, Text, useApp, useInput, useStdout } = runtime;
  const [snapshot, setSnapshot] = useState<InkCliSnapshot>(() => ({
    ...DEFAULT_SNAPSHOT,
    ...controller.getSnapshot(),
  }));
  const [input, setInput] = useState('');
  const [cursor, setCursor] = useState(0);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const [historyDraft, setHistoryDraft] = useState('');
  const [clearedEventCount, setClearedEventCount] = useState(0);
  const [cursorVisible, setCursorVisible] = useState(true);
  const [spinnerIndex, setSpinnerIndex] = useState(0);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);
  const app = useApp();
  const { stdout } = useStdout();
  const currentInteractionMode = normalizeInteractionMode(snapshot.mode);
  const statusline = formatStatusline(snapshot);

  useEffect(() => controller.subscribe(setSnapshot), [controller]);

  useEffect(() => {
    const timer = setInterval(() => setCursorVisible(current => !current), 500);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!snapshot.isProcessing) {
      return;
    }

    const timer = setInterval(() => setSpinnerIndex(current => current + 1), 120);
    return () => clearInterval(timer);
  }, [snapshot.isProcessing]);

  const updateComposer = (next: ComposerState) => {
    setInput(next.input);
    setCursor(clampCursor(next.input, next.cursor));
    setHistoryIndex(null);
  };

  const replaceComposer = (nextInput: string) => {
    setInput(nextInput);
    setCursor(nextInput.length);
  };

  const submitCurrentInput = () => {
    const submitted = input;
    setInput('');
    setCursor(0);
    setHistory(current => recordHistory(current, submitted));
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

  useInput((value, key) => {
    if (key.ctrl && value === 'c') {
      void controller.shutdown();
      onExit?.();
      app.exit();
      return;
    }

    if (key.ctrl && value === 'l') {
      setClearedEventCount(snapshot.events.length);
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
        return;
      }

      void controller.shutdown();
      onExit?.();
      app.exit();
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
  const visibleEventCount = Math.max(4, Math.min(12, terminalRows - 12));
  const eventsAfterClear = snapshot.events.slice(Math.min(clearedEventCount, snapshot.events.length));
  const visibleEvents = eventsAfterClear.slice(-visibleEventCount);
  const hiddenEventCount = snapshot.events.length - visibleEvents.length;
  const spinner = snapshot.isProcessing ? SPINNER_FRAMES[spinnerIndex % SPINNER_FRAMES.length] : '●';
  const promptLines = useMemo(() => renderPromptLines(input, cursor, cursorVisible), [cursor, cursorVisible, input]);
  const slashSuggestions = useMemo(() => getSlashCommandSuggestions(input, cursor), [cursor, input]);
  const normalizedSuggestionIndex = Math.min(selectedSuggestionIndex, Math.max(0, slashSuggestions.length - 1));
  const selectedSuggestion = slashSuggestions[normalizedSuggestionIndex];
  useEffect(() => {
    setSelectedSuggestionIndex(current => Math.min(current, Math.max(0, slashSuggestions.length - 1)));
  }, [slashSuggestions.length]);

  const maxPromptLines = Math.max(1, Math.min(6, terminalRows - 18));
  const visiblePromptLines = promptLines.slice(-maxPromptLines);
  const hiddenPromptLineCount = promptLines.length - visiblePromptLines.length;
  const keyHint = snapshot.isProcessing
    ? 'Running · Enter queues draft · Esc stop · Shift+Tab mode · Ctrl+C exit'
    : slashSuggestions.length > 0
      ? 'Palette · ↑↓ select · Tab/Enter complete · Shift+Tab mode · Esc clear'
      : input.length > 0
        ? 'Editing · Enter send · Ctrl+J newline · Shift+Tab mode · Esc clear'
      : 'Idle · type / for commands · Shift+Tab mode · ↑↓ history · Ctrl+L clear · Esc exit';
  const lineCount = input.split('\n').length;
  const composerHint = input.length > 0 ? `draft ${lineCount} line${lineCount === 1 ? '' : 's'} · ${input.length} chars` : 'ready for next prompt';
  const modeHint = `${currentInteractionMode}: ${describeInteractionMode(currentInteractionMode)}`;
  const queuedHint = snapshot.queuedInputs > 0 ? ` · queued ${snapshot.queuedInputs}` : '';
  const hiddenHint = hiddenEventCount > 0 ? ` · ${hiddenEventCount} older` : '';
  const progressColor = snapshot.isProcessing ? 'yellow' : snapshot.status === 'Cancelled' ? 'red' : 'green';
  const toolProgress = snapshot.toolCalls > 0 ? `${snapshot.completedTools}/${snapshot.toolCalls} tools` : 'no tools yet';

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column">
        <Text bold color="cyan">{statusline}</Text>
        <Text color="gray">
          {snapshot.messages} msgs · ~{snapshot.estimatedTokens} tokens
          {snapshot.taskListId ? ` · tasks ${snapshot.taskListId}` : ''}
        </Text>
      </Box>

      <Box marginTop={1} borderStyle="single" borderColor={progressColor} paddingX={1} flexDirection="column">
        <Text bold color={progressColor}>Progress · {snapshot.phase ?? (snapshot.isProcessing ? 'Running' : 'Idle')}</Text>
        <Text color="gray">{toolProgress}{snapshot.activeTool ? ` · active ${snapshot.activeTool}` : ''}{snapshot.lastStep ? ` · last ${snapshot.lastStep}` : ''}{snapshot.queuedInputs > 0 ? ` · queued ${snapshot.queuedInputs}` : ''}</Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        {visibleEvents.length === 0 ? (
          <Text color="gray">Type a message below. Use /help for commands.{clearedEventCount > 0 ? ' Ctrl+L cleared visible history.' : ''}</Text>
        ) : visibleEvents.map(event => (
          <Box key={event.id} flexDirection="column" marginBottom={1}>
            <Text bold color={event.status ? EVENT_STATUS_COLOR[event.status] : KIND_COLOR[event.kind]}>
              {event.status ? `${EVENT_STATUS_ICON[event.status]} ` : ''}{KIND_LABEL[event.kind]}{event.title ? ` · ${event.title}` : ''}{event.summary ? ` · ${event.summary}` : ''}
            </Text>
            <Text color={event.kind === 'tool' ? 'gray' : undefined}>{event.text}</Text>
          </Box>
        ))}
      </Box>

      <Box borderStyle="single" borderColor={snapshot.isProcessing ? 'yellow' : 'green'} paddingX={1} flexDirection="column">
        <Text color={snapshot.isProcessing ? 'yellow' : 'green'}>
          {spinner} {snapshot.status}{queuedHint}{hiddenHint}
        </Text>
        <Text color="gray">{keyHint} · {composerHint}</Text>
        <Text color="gray">Mode · {modeHint}</Text>
        {slashSuggestions.length > 0 ? (
          <Box flexDirection="column">
            <Text color="yellow">Commands · ↑↓ select · Tab/Enter completes</Text>
            {slashSuggestions.map((suggestion, index) => (
              <Text key={suggestion.command} color={index === normalizedSuggestionIndex ? 'yellow' : 'gray'}>
                {index === normalizedSuggestionIndex ? '→ ' : '  '}{suggestion.command} <Text color="gray">[{suggestion.group}] {suggestion.description}</Text>
              </Text>
            ))}
            {selectedSuggestion?.usage ? <Text color="gray">Hint: {selectedSuggestion.usage}</Text> : null}
          </Box>
        ) : null}
        <Box flexDirection="column">
          {hiddenPromptLineCount > 0 ? <Text color="gray">… {hiddenPromptLineCount} earlier draft line{hiddenPromptLineCount === 1 ? '' : 's'}</Text> : null}
          {visiblePromptLines.map((line, index) => (
            <Text key={`${index}-${line}`} color="cyan">
              {index === 0 ? '› ' : '  '}<Text color="white">{line || ' '}</Text>
            </Text>
          ))}
        </Box>
      </Box>
    </Box>
  );
}
