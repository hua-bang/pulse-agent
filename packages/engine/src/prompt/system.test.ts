import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { generateSystemPrompt } from './system.js';

describe('generateSystemPrompt', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('appends AGENTS.md after the built-in prompt instead of replacing it', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'prompt-'));
    writeFileSync(path.join(dir, 'AGENTS.md'), 'Use pnpm only.');
    vi.spyOn(process, 'cwd').mockReturnValue(dir);

    const prompt = generateSystemPrompt();

    expect(prompt).toContain('## Clarification Tool');
    expect(prompt).toContain('## Project instructions (AGENTS.md)\nUse pnpm only.');
    expect(prompt.indexOf('## Clarification Tool')).toBeLessThan(prompt.indexOf('Use pnpm only.'));
  });

  it('reports the real platform and the current working directory', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'prompt-'));
    vi.spyOn(process, 'cwd').mockReturnValue(dir);

    const prompt = generateSystemPrompt();

    expect(prompt).toContain(`Platform: ${process.platform}`);
    expect(prompt).toContain(`Working directory: ${dir}`);
    expect(prompt).not.toContain('apply_patch');
  });
});
