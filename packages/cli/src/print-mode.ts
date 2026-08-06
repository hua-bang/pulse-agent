import { PulseAgent, type Context } from 'pulse-coder-engine';

import { memoryIntegration } from './memory-integration.js';
import { createPulseCliTools } from './runtime-tools.js';

async function readAllStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf-8');
}

/**
 * Non-interactive one-shot mode: `pulse-coder -p "<prompt>"`.
 * Piped stdin is appended to the prompt, so `git diff | pulse-coder -p "review"` works.
 * Streams the assistant text to stdout and exits; no session is persisted.
 */
export async function runPrintMode(promptArg: string): Promise<number> {
  // Keep stdout clean for the streamed answer (so `pulse-coder -p … | tool`
  // works); engine/plugin console logging goes to stderr instead.
  console.log = (...args: unknown[]) => console.error(...args);
  console.info = console.log;
  console.debug = console.log;

  const stdinText = process.stdin.isTTY ? '' : await readAllStdin();
  const prompt = [promptArg.trim(), stdinText.trim()].filter(Boolean).join('\n\n');
  if (!prompt) {
    console.error('Usage: pulse-coder -p "<prompt>"  (or pipe input on stdin)');
    return 1;
  }

  const agent = new PulseAgent({
    enginePlugins: {
      plugins: [memoryIntegration.enginePlugin],
      dirs: ['.pulse-coder/engine-plugins', '.coder/engine-plugins', '~/.pulse-coder/engine-plugins', '~/.coder/engine-plugins'],
      scan: true
    },
    userConfigPlugins: {
      dirs: ['.pulse-coder/config', '.coder/config', '~/.pulse-coder/config', '~/.coder/config'],
      scan: true
    },
    tools: createPulseCliTools()
  });

  await memoryIntegration.initialize();
  await agent.initialize();

  const context: Context = { messages: [{ role: 'user', content: prompt }] };
  const ac = new AbortController();
  const onSigint = () => ac.abort();
  process.once('SIGINT', onSigint);

  let sawText = false;
  try {
    const result = await agent.run(context, {
      abortSignal: ac.signal,
      onText: (delta) => {
        sawText = true;
        process.stdout.write(delta);
      },
    });

    if (!sawText && result) {
      process.stdout.write(result);
    }
    process.stdout.write('\n');
    return 0;
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      console.error('\nCancelled.');
      return 130;
    }
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  } finally {
    process.off('SIGINT', onSigint);
  }
}
