import type { SqliteContext } from './context.js';
import { StorageError } from '../errors.js';

export type LocalDomain = 'canvas' | 'conversations';
type ActivationState = 'staging' | 'active' | 'unknown';
export interface LocalActivationRecord { domain: LocalDomain; state: ActivationState }
export interface LocalActivationRepository {
  read(): Promise<LocalActivationRecord[]>;
  adoptLegacyMarker(domains: readonly LocalDomain[]): Promise<void>;
  begin(domain: LocalDomain): Promise<void>;
  complete(domain: LocalDomain): Promise<void>;
  /** True only before any cutover began and before any domain record or revision exists. */
  isPristine(): Promise<boolean>;
}

export function createLocalActivationRepository(ctx: SqliteContext): LocalActivationRepository {
  const rows = ctx.db.prepare('SELECT domain, state FROM local_activations ORDER BY domain');
  const set = ctx.db.prepare('INSERT INTO local_activations (domain, state) VALUES (?, ?) ON CONFLICT(domain) DO UPDATE SET state = excluded.state');
  const read = (): LocalActivationRecord[] => {
    const records = rows.all() as LocalActivationRecord[];
    if (records.some(record => !['canvas', 'conversations'].includes(record.domain)
      || !['staging', 'active', 'unknown'].includes(record.state))) {
      throw new StorageError('corrupt_data', 'Invalid database activation state');
    }
    return records;
  };
  const domainHasData = (domain: LocalDomain) => domain === 'canvas'
    ? !!ctx.db.prepare("SELECT 1 FROM workspaces UNION ALL SELECT 1 FROM resource_versions WHERE domain = 'canvas' LIMIT 1").get()
    : !!ctx.db.prepare(`
      SELECT 1 FROM conversations UNION ALL SELECT 1 FROM conversation_scopes
      UNION ALL SELECT 1 FROM resource_versions WHERE domain IN ('conversation', 'conversation-scope') LIMIT 1
    `).get();
  const validate = (domain: LocalDomain) => {
    if (domain !== 'canvas' && domain !== 'conversations') throw new StorageError('invalid_argument', 'Unknown local storage domain');
  };
  const adopt = ctx.db.transaction((domains: readonly LocalDomain[]) => {
    for (const domain of domains) {
      validate(domain);
      const current = read().find(record => record.domain === domain);
      if (current?.state === 'unknown') set.run(domain, 'active');
      else if (current?.state !== 'active') {
        throw new StorageError('corrupt_data', 'The activation marker contradicts the database migration state');
      }
    }
    for (const current of read()) {
      if (current.state === 'unknown' && !domains.includes(current.domain) && !domainHasData(current.domain)) {
        ctx.db.prepare('DELETE FROM local_activations WHERE domain = ?').run(current.domain);
      }
    }
  });
  const begin = ctx.db.transaction((domain: LocalDomain) => {
    validate(domain);
    const current = read().find(record => record.domain === domain);
    if (current?.state === 'active') throw new StorageError('revision_conflict', 'This domain is already authoritative; never re-import legacy files');
    if ((!current || current.state === 'unknown') && domainHasData(domain)) {
      throw new StorageError('corrupt_data', 'Existing migration state is unknown; refusing to overwrite database records');
    }
    set.run(domain, 'staging');
  });
  const complete = ctx.db.transaction((domain: LocalDomain) => {
    validate(domain);
    const current = read().find(record => record.domain === domain);
    if (current?.state === 'active') return;
    if (current?.state !== 'staging') throw new StorageError('corrupt_data', 'Only a verified staging import can become authoritative');
    set.run(domain, 'active');
  });
  return {
    async read() { return ctx.guard(read); },
    async adoptLegacyMarker(domains) { ctx.guard(() => adopt.immediate(domains)); },
    async begin(domain) { ctx.guard(() => begin.immediate(domain)); },
    async complete(domain) { ctx.guard(() => complete.immediate(domain)); },
    async isPristine() {
      return ctx.guard(() => ctx.db.transaction(() => read().length === 0
        && !domainHasData('canvas') && !domainHasData('conversations')).deferred());
    },
  };
}
