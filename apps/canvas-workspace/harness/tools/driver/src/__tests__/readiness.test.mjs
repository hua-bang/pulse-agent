import { describe, expect, it } from 'vitest';
import { APP_RENDERED_EXPRESSION, pendingContentExpression, waitForContentSettled } from '../readiness.mjs';
import { resolveUserPath } from '../utils.mjs';

// Replays a scripted sequence of renderer answers (an Error means "throws").
const scripted = (answers) => {
  let i = 0;
  const evaluate = async () => {
    const answer = answers[Math.min(i, answers.length - 1)];
    i += 1;
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { evaluate, calls: () => i };
};

describe('waitForContentSettled', () => {
  it('requires consecutive clean polls, so a gap between lazy mounts does not count', async () => {
    const renderer = scripted([['node-body'], [], ['webview'], [], []]);
    await expect(waitForContentSettled({}, { evaluate: renderer.evaluate, pollMs: 1 }))
      .resolves.toEqual({ settled: true });
    expect(renderer.calls()).toBe(5);
  });

  it('keeps polling through renderer restarts', async () => {
    const renderer = scripted([new Error('navigating'), [], []]);
    await expect(waitForContentSettled({}, { evaluate: renderer.evaluate, pollMs: 1 }))
      .resolves.toEqual({ settled: true });
  });

  it('reports what is still pending on timeout instead of failing the launch', async () => {
    const renderer = scripted([['file-preview', 'webview']]);
    await expect(waitForContentSettled({}, { evaluate: renderer.evaluate, pollMs: 1, timeoutMs: 20 }))
      .resolves.toEqual({ settled: false, pending: ['file-preview', 'webview'] });
  });
});

describe('readiness expressions', () => {
  it('matches React output positively rather than the splash being absent', () => {
    expect(APP_RENDERED_EXPRESSION).toContain(":not(.boot-screen)");
  });

  it('checks only the explicit first-paint selectors plus webviews', () => {
    const expression = pendingContentExpression({ card: '.card:empty' });
    expect(expression).toContain('".card:empty"');
    expect(expression).toContain("querySelectorAll('webview')");
    expect(expression).not.toContain('--loading"]');
  });
});

describe('resolveUserPath', () => {
  it('resolves relative paths from the pnpm invocation directory', () => {
    expect(resolveUserPath('out.png', { INIT_CWD: '/repo' })).toBe('/repo/out.png');
    expect(resolveUserPath('/abs/out.png', { INIT_CWD: '/repo' })).toBe('/abs/out.png');
  });

  it('falls back to the process cwd outside pnpm', () => {
    expect(resolveUserPath('out.png', {})).toBe(`${process.cwd()}/out.png`);
  });
});
