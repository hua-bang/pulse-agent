import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

let child;

afterEach(async () => {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await once(child, 'exit');
  child = undefined;
});

describe('mock LLM Responses transport', () => {
  it('streams non-empty Responses API text for the endpoint Canvas actually uses', async () => {
    const port = 18_200 + Math.floor(Math.random() * 500);
    child = spawn(process.execPath, [
      resolve('harness/mock-llm.mjs'),
      String(port),
    ], {
      cwd: resolve('.'),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await new Promise((resolveReady, reject) => {
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', chunk => {
        if (chunk.includes('mock-llm listening')) resolveReady();
      });
      child.once('error', reject);
      child.once('exit', code => reject(new Error(`mock exited before ready: ${code}`)));
    });

    const response = await fetch(`http://127.0.0.1:${port}/v1/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'mock-model',
        stream: true,
        input: [{
          role: 'user',
          content: [{ type: 'input_text', text: 'hello responses' }],
        }],
      }),
    });
    const body = await response.text();
    const events = body
      .split('\n')
      .filter(line => line.startsWith('data: '))
      .map(line => JSON.parse(line.slice('data: '.length)));
    const streamedText = events
      .filter(event => event.type === 'response.output_text.delta')
      .map(event => event.delta)
      .join('');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(body).toContain('response.output_text.delta');
    expect(streamedText).toBe('[mock] you said: hello responses');
    expect(body).toContain('response.completed');
  });
});
