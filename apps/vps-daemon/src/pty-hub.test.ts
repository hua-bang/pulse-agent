import { mkdtempSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { missedOutput, resolveSpawnCwd } from './pty-hub.js';

describe('resolveSpawnCwd', () => {
  const existing = mkdtempSync(join(tmpdir(), 'pty-cwd-'));
  const missing = join(existing, 'does-not-exist');

  it('keeps a requested folder that exists on this host', () => {
    expect(resolveSpawnCwd([existing, '/srv/other'], '/fallback')).toBe(existing);
  });

  it('falls back to the configured folder when the requested one is desktop-local', () => {
    expect(resolveSpawnCwd(['/Users/someone/project', existing], '/fallback')).toBe(existing);
  });

  it('expands ~ before checking existence', () => {
    expect(resolveSpawnCwd(['~'], '/fallback')).toBe(homedir());
  });

  it('uses the daemon default when no candidate exists', () => {
    expect(resolveSpawnCwd([missing, undefined, '  '], '/fallback')).toBe('/fallback');
  });
});

describe('missedOutput', () => {
  const record = { scrollback: 'abcdef', outputChars: 10 };

  it('returns nothing when the client is caught up', () => {
    expect(missedOutput(record, 10)).toBe('');
    expect(missedOutput(record, 12)).toBe('');
  });

  it('returns only the missed tail', () => {
    expect(missedOutput(record, 7)).toBe('def');
  });

  it('returns the whole scrollback when the gap exceeds it', () => {
    expect(missedOutput(record, 2)).toBe('abcdef');
  });
});
