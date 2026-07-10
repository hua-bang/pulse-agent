export const PERF_CHAT_REPLAY_MESSAGE = '__pulse_perf_chat_stream__';

interface ReplaySender {
  isDestroyed: () => boolean;
  send: (channel: string, payload: unknown) => void;
}

interface ReplayOptions {
  intervalMs?: number;
  startupDelayMs?: number;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const buildCodeDenseResponse = (): string => {
  const functions = Array.from({ length: 220 }, (_, index) => (
    `export function transform${index}(value: number): number {\n`
    + `  const weighted = value * ${index + 3};\n`
    + `  return weighted % ${index + 17};\n`
    + '}\n'
  )).join('\n');
  return [
    '# Streaming performance replay',
    '',
    'The following code-dense response exercises incremental Markdown parsing.',
    '',
    '```typescript',
    functions,
    '```',
    '',
    '```mermaid',
    'flowchart LR',
    '  Input --> Parse --> Render --> Commit',
    '```',
  ].join('\n');
};

const splitIntoChunks = (content: string, chunkSize = 48): string[] => {
  const chunks: string[] = [];
  for (let offset = 0; offset < content.length; offset += chunkSize) {
    chunks.push(content.slice(offset, offset + chunkSize));
  }
  return chunks;
};

export const isPerfChatReplayRequest = (message: string, perfEnabled: boolean): boolean => (
  perfEnabled && message === PERF_CHAT_REPLAY_MESSAGE
);

export const replayPerfChatStream = async (
  sender: ReplaySender,
  sessionId: string,
  options: ReplayOptions = {},
): Promise<void> => {
  const content = buildCodeDenseResponse();
  await sleep(options.startupDelayMs ?? 80);
  for (const chunk of splitIntoChunks(content)) {
    if (sender.isDestroyed()) return;
    sender.send(`canvas-agent:text-delta:${sessionId}`, chunk);
    await sleep(options.intervalMs ?? 4);
  }
  if (!sender.isDestroyed()) {
    sender.send(`canvas-agent:chat-complete:${sessionId}`, {
      ok: true,
      response: content,
      runId: `perf-replay-${sessionId}`,
    });
  }
};
