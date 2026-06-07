import { ipcMain } from "electron";
import { execFile } from "child_process";
import { existsSync } from "fs";
import { readFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";

export interface CodexSessionIndexEntry {
  id: string;
  threadName?: string;
  updatedAt: string;
}

export interface CodexThreadMatch {
  id: string;
  cwd?: string;
  title?: string;
  updatedAtMs?: number;
}

interface CodexSessionIndexLine {
  id?: unknown;
  thread_name?: unknown;
  updated_at?: unknown;
}

interface CodexThreadRow {
  id?: unknown;
  cwd?: unknown;
  title?: unknown;
  updatedAtMs?: unknown;
}

export const parseCodexSessionIndex = (text: string): CodexSessionIndexEntry[] => {
  const entries: CodexSessionIndexEntry[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const raw = JSON.parse(trimmed) as CodexSessionIndexLine;
      if (typeof raw.id !== "string" || typeof raw.updated_at !== "string") continue;
      entries.push({
        id: raw.id,
        threadName: typeof raw.thread_name === "string" ? raw.thread_name : undefined,
        updatedAt: raw.updated_at,
      });
    } catch {
      // Ignore malformed historical lines rather than breaking restoration.
    }
  }
  return entries.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
};

export const getCodexSessionIndexPath = (): string =>
  join(process.env.CODEX_HOME || join(homedir(), ".codex"), "session_index.jsonl");

export const getCodexStatePath = (): string =>
  join(process.env.CODEX_HOME || join(homedir(), ".codex"), "state_5.sqlite");

const escapeSqlString = (value: string): string => value.replace(/'/g, "''");

export const normalizeCodexThreadRows = (rows: CodexThreadRow[]): CodexThreadMatch[] =>
  rows
    .filter((row) => typeof row.id === "string")
    .map((row) => ({
      id: row.id as string,
      cwd: typeof row.cwd === "string" ? row.cwd : undefined,
      title: typeof row.title === "string" ? row.title : undefined,
      updatedAtMs: typeof row.updatedAtMs === "number" ? row.updatedAtMs : undefined,
    }));

export const buildCodexThreadMarkerSql = (input: {
  marker: string;
  updatedAfterMs?: number;
  cwd?: string;
}): string => {
  const marker = escapeSqlString(input.marker);
  const clauses = [
    `(instr(COALESCE(first_user_message, ''), '${marker}') > 0 OR instr(COALESCE(preview, ''), '${marker}') > 0)`,
  ];
  if (Number.isFinite(input.updatedAfterMs)) {
    clauses.push(`COALESCE(updated_at_ms, updated_at * 1000, 0) >= ${Math.floor(input.updatedAfterMs!)}`);
  }
  if (input.cwd) {
    clauses.push(`cwd = '${escapeSqlString(input.cwd)}'`);
  }
  return `
SELECT id, cwd, title, COALESCE(updated_at_ms, updated_at * 1000, 0) AS updatedAtMs
FROM threads
WHERE ${clauses.join(" AND ")}
ORDER BY updatedAtMs DESC, id DESC
LIMIT 2;
`.trim();
};

const runSqliteJson = (dbPath: string, sql: string): Promise<unknown[]> =>
  new Promise((resolve, reject) => {
    execFile(
      "sqlite3",
      ["-readonly", "-json", dbPath, sql],
      { timeout: 2_000, maxBuffer: 128 * 1024 },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        const trimmed = stdout.trim();
        if (!trimmed) {
          resolve([]);
          return;
        }
        try {
          const parsed = JSON.parse(trimmed) as unknown;
          resolve(Array.isArray(parsed) ? parsed : []);
        } catch (parseError) {
          reject(parseError);
        }
      },
    );
  });

export const findCodexThreadByMarker = async (input: {
  marker: string;
  updatedAfterMs?: number;
  cwd?: string;
}): Promise<{ session?: CodexThreadMatch; ambiguous?: boolean }> => {
  const marker = input.marker.trim();
  if (!marker) return {};
  const dbPath = getCodexStatePath();
  if (!existsSync(dbPath)) return {};
  const sql = buildCodexThreadMarkerSql({ ...input, marker });
  const rows = normalizeCodexThreadRows(await runSqliteJson(dbPath, sql) as CodexThreadRow[]);
  if (rows.length === 1) return { session: rows[0] };
  if (rows.length > 1) return { ambiguous: true };
  return {};
};

export const readCodexSessionIndex = async (
  updatedAfter?: string,
): Promise<CodexSessionIndexEntry[]> => {
  const text = await readFile(getCodexSessionIndexPath(), "utf8").catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  });
  const updatedAfterMs = updatedAfter ? Date.parse(updatedAfter) : Number.NaN;
  const hasUpdatedAfter = Number.isFinite(updatedAfterMs);
  return parseCodexSessionIndex(text).filter((entry) => {
    if (!hasUpdatedAfter) return true;
    const updatedAtMs = Date.parse(entry.updatedAt);
    return Number.isFinite(updatedAtMs) && updatedAtMs >= updatedAfterMs;
  });
};

export const setupCodexSessionsIpc = () => {
  ipcMain.handle(
    "codex-sessions:list",
    async (_event, payload: { updatedAfter?: string } | undefined) => {
      try {
        const sessions = await readCodexSessionIndex(payload?.updatedAfter);
        return { ok: true, sessions };
      } catch (error) {
        return { ok: false, error: String(error) };
      }
    },
  );
  ipcMain.handle(
    "codex-sessions:find-by-marker",
    async (
      _event,
      payload: { marker?: string; updatedAfterMs?: number; cwd?: string } | undefined,
    ) => {
      try {
        if (!payload?.marker) return { ok: false, error: "missing marker" };
        const result = await findCodexThreadByMarker({
          marker: payload.marker,
          updatedAfterMs: payload.updatedAfterMs,
          cwd: payload.cwd,
        });
        return { ok: true, ...result };
      } catch (error) {
        return { ok: false, error: String(error) };
      }
    },
  );
};
