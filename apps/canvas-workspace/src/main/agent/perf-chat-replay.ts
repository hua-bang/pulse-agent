export const PERF_CHAT_REPLAY_MESSAGE = '__pulse_perf_chat_stream__';

interface ReplaySender {
  isDestroyed: () => boolean;
  send: (channel: string, payload: unknown) => void;
}

interface ReplayOptions {
  intervalMs?: number;
  startupDelayMs?: number;
  onComplete?: (content: string) => Promise<void> | void;
  onStreamEvent?: (
    channel: 'text-delta' | 'chat-complete',
    payload: unknown,
  ) => void;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Optional env overrides so a demo/harness run can SLOW the mock stream down
 * (e.g. PULSE_CANVAS_PERF_INTERVAL_MS=250) and keep a turn visibly streaming
 * long enough to exercise mid-stream UI (session switching). Defaults match
 * the performance measurement speed. */
const envMs = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
};
const replayIntervalMs = (fallback: number): number => envMs('PULSE_CANVAS_PERF_INTERVAL_MS', fallback);
const replayStartupDelayMs = (fallback: number): number => envMs('PULSE_CANVAS_PERF_STARTUP_DELAY_MS', fallback);

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
  const startupDelayMs = replayStartupDelayMs(options.startupDelayMs ?? 80);
  const intervalMs = replayIntervalMs(options.intervalMs ?? 4);
  await sleep(startupDelayMs);
  for (const chunk of splitIntoChunks(content)) {
    if (sender.isDestroyed()) return;
    options.onStreamEvent?.('text-delta', chunk);
    sender.send(`canvas-agent:text-delta:${sessionId}`, chunk);
    await sleep(intervalMs);
  }
  if (!sender.isDestroyed()) {
    await options.onComplete?.(content);
    const completion = {
      ok: true,
      response: content,
      runId: `perf-replay-${sessionId}`,
    };
    options.onStreamEvent?.('chat-complete', completion);
    sender.send(`canvas-agent:chat-complete:${sessionId}`, completion);
  }
};
