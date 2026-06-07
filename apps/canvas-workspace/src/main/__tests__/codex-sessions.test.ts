import { execFileSync } from 'child_process';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import {
  buildCodexThreadMarkerSql,
  findCodexThreadByMarker,
  normalizeCodexThreadRows,
  parseCodexSessionIndex,
} from '../agent/codex-sessions';

const hasSqlite3 = (): boolean => {
  try {
    execFileSync('sqlite3', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

describe('parseCodexSessionIndex', () => {
  it('parses valid Codex session index lines and ignores malformed rows', () => {
    const sessions = parseCodexSessionIndex([
      '{"id":"older","thread_name":"Older task","updated_at":"2026-06-07T01:00:00Z"}',
      'not json',
      '{"id":"newer","thread_name":"Newer task","updated_at":"2026-06-07T02:00:00Z"}',
      '{"id":123,"updated_at":"2026-06-07T03:00:00Z"}',
    ].join('\n'));

    expect(sessions).toEqual([
      { id: 'newer', threadName: 'Newer task', updatedAt: '2026-06-07T02:00:00Z' },
      { id: 'older', threadName: 'Older task', updatedAt: '2026-06-07T01:00:00Z' },
    ]);
  });

  it('normalizes sqlite thread rows without leaking prompt content', () => {
    expect(normalizeCodexThreadRows([
      {
        id: 'thread-1',
        cwd: '/repo',
        title: 'Task',
        updatedAtMs: 123,
      },
      { id: 42, cwd: '/repo' },
    ])).toEqual([
      {
        id: 'thread-1',
        cwd: '/repo',
        title: 'Task',
        updatedAtMs: 123,
      },
    ]);
  });

  it('builds a marker lookup query with escaped literals', () => {
    const sql = buildCodexThreadMarkerSql({
      marker: "pulse-canvas-codex-binding:node:'abc'",
      cwd: "/repo/it's-here",
      updatedAfterMs: 1234.9,
    });

    expect(sql).toContain("instr(COALESCE(first_user_message, ''), 'pulse-canvas-codex-binding:node:''abc''')");
    expect(sql).toContain("cwd = '/repo/it''s-here'");
    expect(sql).toContain('>= 1234');
  });

  (hasSqlite3() ? it : it.skip)('finds a Codex thread by marker from a real sqlite state db', async () => {
    const previousCodexHome = process.env.CODEX_HOME;
    const codexHome = await fs.mkdtemp(join(tmpdir(), 'codex-state-test-'));
    const dbPath = join(codexHome, 'state_5.sqlite');
    const marker = 'pulse-canvas-codex-binding:node-1:test-marker';
    const cwd = '/tmp/codex-marker-repo';

    try {
      process.env.CODEX_HOME = codexHome;
      execFileSync('sqlite3', [dbPath, `
        CREATE TABLE threads (
          id TEXT PRIMARY KEY,
          cwd TEXT NOT NULL,
          title TEXT NOT NULL,
          updated_at INTEGER NOT NULL,
          updated_at_ms INTEGER,
          first_user_message TEXT NOT NULL DEFAULT '',
          preview TEXT NOT NULL DEFAULT ''
        );
        INSERT INTO threads (
          id,
          cwd,
          title,
          updated_at,
          updated_at_ms,
          first_user_message,
          preview
        ) VALUES (
          'thread-marker-hit',
          '${cwd}',
          'Marker hit',
          1,
          2000,
          'Please do the work. <!-- ${marker} -->',
          ''
        );
      `]);

      const result = await findCodexThreadByMarker({
        marker,
        cwd,
        updatedAfterMs: 1000,
      });

      expect(result).toEqual({
        session: {
          id: 'thread-marker-hit',
          cwd,
          title: 'Marker hit',
          updatedAtMs: 2000,
        },
      });
    } finally {
      if (previousCodexHome === undefined) {
        delete process.env.CODEX_HOME;
      } else {
        process.env.CODEX_HOME = previousCodexHome;
      }
      await fs.rm(codexHome, { recursive: true, force: true });
    }
  });
});
