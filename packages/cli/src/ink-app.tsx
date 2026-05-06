import React, { useEffect, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';

export type InkEventKind = 'user' | 'assistant' | 'tool' | 'result' | 'system' | 'error';

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

interface InkCliAppProps {
  initialSnapshot?: Partial<InkCliSnapshot>;
  onExit?: () => void;
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

export function InkCliApp({ initialSnapshot, onExit }: InkCliAppProps) {
  const [snapshot, setSnapshot] = useState<InkCliSnapshot>({
    ...DEFAULT_SNAPSHOT,
    ...initialSnapshot,
    events: initialSnapshot?.events ?? DEFAULT_SNAPSHOT.events,
  });
  const app = useApp();

  useInput((_input, key) => {
    if (key.escape || (key.ctrl && _input === 'c')) {
      setSnapshot(current => ({ ...current, status: 'Exiting…' }));
      onExit?.();
      app.exit();
    }
  });

  useEffect(() => {
    const timer = setInterval(() => {
      setSnapshot(current => {
        if (!current.isProcessing) {
          return current;
        }
        return { ...current, status: current.status.endsWith('…') ? 'Running' : `${current.status}…` };
      });
    }, 500);

    return () => clearInterval(timer);
  }, []);

  const visibleEvents = snapshot.events.slice(-8);

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
          <Text color="gray">Type in the classic prompt below. Ink event cards will appear here as the agent runs.</Text>
        ) : visibleEvents.map(event => (
          <Box key={event.id} flexDirection="column" marginBottom={1}>
            <Text bold color={KIND_COLOR[event.kind]}>
              {KIND_LABEL[event.kind]}{event.title ? ` · ${event.title}` : ''}
            </Text>
            <Text>{event.text}</Text>
          </Box>
        ))}
      </Box>

      <Box borderStyle="single" borderColor={snapshot.isProcessing ? 'yellow' : 'green'} paddingX={1}>
        <Text color={snapshot.isProcessing ? 'yellow' : 'green'}>
          {snapshot.status} · Esc/Ctrl+C exits Ink shell · fallback: PULSE_CODER_UI=readline
        </Text>
      </Box>
    </Box>
  );
}
