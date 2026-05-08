import React, { useEffect, useMemo, useState } from 'react';

export type InkEventKind = 'user' | 'assistant' | 'tool' | 'result' | 'system' | 'error';

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
}

export interface InkCliSnapshot {
  sessionId?: string | null;
  taskListId?: string | null;
  mode?: string | null;
  messages: number;
  estimatedTokens: number;
  isProcessing: boolean;
  status: string;
  events: InkCliEvent[];
}

export interface InkCliController {
  getSnapshot: () => InkCliSnapshot;
  submitInput: (input: string) => void | Promise<void>;
  requestStop: () => void;
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
}

const DEFAULT_SNAPSHOT: InkCliSnapshot = {
  sessionId: null,
  taskListId: null,
  mode: null,
  messages: 0,
  estimatedTokens: 0,
  isProcessing: false,
  status: 'Ready',
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

const SLASH_COMMANDS: SlashCommandSuggestion[] = [
  { command: '/help', description: 'Show commands and shortcuts' },
  { command: '/new', description: 'Create a new session' },
  { command: '/resume', description: 'Resume a saved session' },
  { command: '/sessions', description: 'List saved sessions' },
  { command: '/search', description: 'Search saved sessions' },
  { command: '/rename', description: 'Rename a session' },
  { command: '/delete', description: 'Delete a session' },
  { command: '/clear', description: 'Clear conversation context' },
  { command: '/compact', description: 'Compact current context' },
  { command: '/skills', description: 'Run a message with a selected skill' },
  { command: '/acp', description: 'Manage ACP mode' },
  { command: '/wt', description: 'Use worktree skill' },
  { command: '/status', description: 'Show session status' },
  { command: '/mode', description: 'Show plan mode' },
  { command: '/plan', description: 'Switch to planning mode' },
  { command: '/execute', description: 'Switch to executing mode' },
  { command: '/team', description: 'Run a multi-agent team' },
  { command: '/teams', description: 'Enter teams mode' },
  { command: '/solo', description: 'Exit teams mode' },
  { command: '/save', description: 'Save current session' },
  { command: '/tui', description: 'Show TUI status' },
  { command: '/exit', description: 'Save and exit' },
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
    .filter(item => item.command.slice(1).startsWith(query))
    .slice(0, limit);
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
  const app = useApp();
  const { stdout } = useStdout();

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

    if (key.tab || value === '\t') {
      const [suggestion] = getSlashCommandSuggestions(input, cursor, 1);
      if (suggestion) {
        updateComposer(applySlashCommandCompletion(input, cursor, suggestion.command));
      }
      return;
    }

    if (key.ctrl && (value === 'j' || value === '\n')) {
      updateComposer(insertAtCursor({ input, cursor }, '\n'));
      return;
    }

    if (key.return) {
      submitCurrentInput();
      return;
    }

    if (key.upArrow) {
      showPreviousHistory();
      return;
    }

    if (key.downArrow) {
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
  const maxPromptLines = Math.max(1, Math.min(6, terminalRows - 18));
  const visiblePromptLines = promptLines.slice(-maxPromptLines);
  const hiddenPromptLineCount = promptLines.length - visiblePromptLines.length;
  const keyHint = snapshot.isProcessing
    ? 'Running · Esc stop · after stopping, Enter queues next prompt'
    : input.length > 0
      ? 'Editing · Enter send · Ctrl+J newline · Tab complete · Esc clear'
      : 'Idle · type / for commands · ↑↓ history · Ctrl+L clear · Esc exit';
  const lineCount = input.split('\n').length;
  const composerHint = input.length > 0 ? `draft ${lineCount} line${lineCount === 1 ? '' : 's'} · ${input.length} chars` : 'ready for next prompt';
  const historyHint = history.length > 0 ? ` · history ${historyIndex === null ? history.length : `${historyIndex + 1}/${history.length}`}` : '';
  const hiddenHint = hiddenEventCount > 0 ? ` · ${hiddenEventCount} older` : '';

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column">
        <Text bold color="cyan">Pulse Coder Ink</Text>
        <Text color="gray">
          session {snapshot.sessionId ?? 'new'} · {snapshot.messages} msgs · ~{snapshot.estimatedTokens} tokens
          {snapshot.taskListId ? ` · tasks ${snapshot.taskListId}` : ''}
          {snapshot.mode ? ` · mode ${snapshot.mode}` : ''}
        </Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        {visibleEvents.length === 0 ? (
          <Text color="gray">Type a message below. Use /help for commands.{clearedEventCount > 0 ? ' Ctrl+L cleared visible history.' : ''}</Text>
        ) : visibleEvents.map(event => (
          <Box key={event.id} flexDirection="column" marginBottom={1}>
            <Text bold color={KIND_COLOR[event.kind]}>
              {KIND_LABEL[event.kind]}{event.title ? ` · ${event.title}` : ''}
            </Text>
            <Text>{event.text}</Text>
          </Box>
        ))}
      </Box>

      <Box borderStyle="single" borderColor={snapshot.isProcessing ? 'yellow' : 'green'} paddingX={1} flexDirection="column">
        <Text color={snapshot.isProcessing ? 'yellow' : 'green'}>
          {spinner} {snapshot.status}{historyHint}{hiddenHint}
        </Text>
        <Text color="gray">{keyHint} · {composerHint}</Text>
        {slashSuggestions.length > 0 ? (
          <Box flexDirection="column">
            <Text color="yellow">Commands · Tab completes first match</Text>
            {slashSuggestions.map((suggestion, index) => (
              <Text key={suggestion.command} color={index === 0 ? 'yellow' : 'gray'}>
                {index === 0 ? '→ ' : '  '}{suggestion.command} <Text color="gray">{suggestion.description}</Text>
              </Text>
            ))}
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
