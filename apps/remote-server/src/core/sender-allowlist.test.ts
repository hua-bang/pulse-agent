import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isSenderAllowed, parseAllowlistFile, senderKeys } from './sender-allowlist.js';

const dm = { platformKey: 'feishu:ou_guest', memoryKey: 'feishu:user:ou_guest' };
const group = { platformKey: 'feishu:group:oc_team:user:ou_guest', memoryKey: 'feishu:user:ou_guest' };
const topic = { platformKey: 'feishu:group:oc_team:topic:t1:user:ou_guest', memoryKey: 'feishu:user:ou_guest' };

describe('sender allowlist', () => {
  let dir: string;
  let file: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'allowlist-'));
    file = join(dir, 'allowed-senders.json');
    env = { REMOTE_ALLOWED_SENDERS_FILE: file };
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function writeList(content: unknown, mtimeSec: number): void {
    writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
    utimesSync(file, mtimeSec, mtimeSec);
  }

  it('allows everyone when there is no file and the env list is empty', () => {
    expect(isSenderAllowed(dm, env)).toBe(true);
    expect(isSenderAllowed(dm, { ...env, REMOTE_ALLOWED_SENDERS: ' , ' })).toBe(true);
  });

  it('matches a listed sender in DMs and groups (env list)', () => {
    const withEnv = { ...env, REMOTE_ALLOWED_SENDERS: 'feishu:user:ou_guest, discord:user:42' };
    expect(isSenderAllowed(dm, withEnv)).toBe(true);
    expect(isSenderAllowed(group, withEnv)).toBe(true);
    expect(isSenderAllowed({ platformKey: 'discord:thread:9', memoryKey: 'discord:user:42' }, withEnv)).toBe(true);
    expect(isSenderAllowed({ platformKey: 'feishu:ou_other', memoryKey: 'feishu:user:ou_other' }, withEnv)).toBe(false);
  });

  it('reads the list file, with notes, and picks up edits without a restart', () => {
    writeList({ senders: [{ id: 'feishu:chat:oc_team', note: 'external group' }] }, 1000);
    expect(isSenderAllowed(group, env)).toBe(true);
    expect(isSenderAllowed(topic, env)).toBe(true);
    expect(isSenderAllowed(dm, env)).toBe(false);
    expect(isSenderAllowed({ ...group, platformKey: 'feishu:group:oc_other:user:ou_guest' }, env)).toBe(false);

    writeList(['feishu:user:ou_guest'], 2000);
    expect(isSenderAllowed(dm, env)).toBe(true);
  });

  it('merges the file and the env list', () => {
    writeList(['feishu:user:ou_owner'], 1000);
    const withEnv = { ...env, REMOTE_ALLOWED_SENDERS: 'feishu:user:ou_guest' };
    expect(isSenderAllowed(dm, withEnv)).toBe(true);
    expect(isSenderAllowed({ platformKey: 'feishu:ou_owner', memoryKey: 'feishu:user:ou_owner' }, withEnv)).toBe(true);
  });

  it('rejects everyone when the list file is malformed', () => {
    writeList('{ not json', 1000);
    expect(isSenderAllowed(dm, { ...env, REMOTE_ALLOWED_SENDERS: 'feishu:user:ou_guest' })).toBe(false);
    expect(() => parseAllowlistFile('{"senders":[{"note":"x"}]}')).toThrow('entry 0 has no id');
  });

  it('reports the sender key first and the group key second', () => {
    expect(senderKeys(group)).toEqual(['feishu:user:ou_guest', 'feishu:chat:oc_team']);
    expect(senderKeys(dm)).toEqual(['feishu:user:ou_guest']);
  });
});
