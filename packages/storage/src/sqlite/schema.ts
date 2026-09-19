import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { StorageError } from '../errors.js';
import { CONVERSATION_SCOPES_SCHEMA } from './conversation-scopes.js';
import { FILE_WRITES_SCHEMA } from './file-writes.js';

const SCHEMA_VERSION = 1;

export function initializeSchema(db: Database.Database): void {
  const current = db.pragma('user_version', { simple: true }) as number;
  if (current > SCHEMA_VERSION) {
    throw new StorageError('unsupported_schema', `Storage schema ${current} is newer than supported ${SCHEMA_VERSION}`);
  }
  if (current === SCHEMA_VERSION) return;
  db.transaction(() => {
    // A second opener may have completed the migration while we waited for the lock.
    const lockedVersion = db.pragma('user_version', { simple: true }) as number;
    if (lockedVersion === SCHEMA_VERSION) return;
    if (lockedVersion !== 0) throw new StorageError('unsupported_schema', 'Unsupported storage schema');
    db.exec(`
      CREATE TABLE storage_identity (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        generation TEXT NOT NULL
      ) STRICT;
      CREATE TABLE workspaces (
        id TEXT PRIMARY KEY NOT NULL,
        revision INTEGER NOT NULL CHECK (revision > 0),
        metadata TEXT NOT NULL CHECK (json_valid(metadata))
      ) STRICT;
      CREATE TABLE canvas_records (
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        collection TEXT NOT NULL CHECK (collection IN ('node', 'placement', 'edge')),
        id TEXT NOT NULL,
        body TEXT NOT NULL CHECK (json_valid(body)),
        PRIMARY KEY (workspace_id, collection, id)
      ) STRICT;
      CREATE TABLE conversations (
        scope_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        revision INTEGER NOT NULL CHECK (revision > 0),
        metadata TEXT NOT NULL CHECK (json_valid(metadata)),
        PRIMARY KEY (scope_id, session_id)
      ) STRICT;
      CREATE TABLE conversation_messages (
        scope_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        id TEXT NOT NULL,
        position INTEGER NOT NULL CHECK (position >= 0),
        body TEXT NOT NULL CHECK (json_valid(body)),
        PRIMARY KEY (scope_id, session_id, id),
        UNIQUE (scope_id, session_id, position),
        FOREIGN KEY (scope_id, session_id)
          REFERENCES conversations(scope_id, session_id) ON DELETE CASCADE
      ) STRICT;
      CREATE TABLE resource_versions (
        domain TEXT NOT NULL CHECK (domain IN ('canvas', 'conversation', 'conversation-scope')),
        scope_id TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        revision INTEGER NOT NULL CHECK (revision > 0),
        PRIMARY KEY (domain, scope_id, resource_id)
      ) STRICT;
      CREATE TABLE storage_changes (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        domain TEXT NOT NULL CHECK (domain IN ('canvas', 'conversation', 'conversation-scope')),
        scope_id TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        revision INTEGER NOT NULL CHECK (revision > 0),
        kind TEXT NOT NULL CHECK (kind IN ('updated', 'removed')),
        changed_ids TEXT NOT NULL CHECK (json_valid(changed_ids))
      ) STRICT;
      PRAGMA user_version = 1;
    `);
    db.exec(CONVERSATION_SCOPES_SCHEMA);
    db.exec(FILE_WRITES_SCHEMA);
    db.prepare('INSERT INTO storage_identity (singleton, generation) VALUES (1, ?)').run(randomUUID());
  }).immediate();
}
