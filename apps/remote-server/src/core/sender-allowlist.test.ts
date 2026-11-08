import { describe, expect, it } from 'vitest';
import { isSenderAllowed, parseAllowedSenders, senderKeys } from './sender-allowlist.js';

const dm = { platformKey: 'feishu:ou_guest', memoryKey: 'feishu:user:ou_guest' };
const group = { platformKey: 'feishu:group:oc_team:user:ou_guest', memoryKey: 'feishu:user:ou_guest' };
const topic = { platformKey: 'feishu:group:oc_team:topic:t1:user:ou_guest', memoryKey: 'feishu:user:ou_guest' };

describe('sender allowlist', () => {
  it('allows everyone when REMOTE_ALLOWED_SENDERS is unset or empty', () => {
    expect(isSenderAllowed(dm, {})).toBe(true);
    expect(isSenderAllowed(dm, { REMOTE_ALLOWED_SENDERS: ' , ' })).toBe(true);
    expect(parseAllowedSenders(undefined)).toBeNull();
  });

  it('matches a listed sender in DMs and groups', () => {
    const env = { REMOTE_ALLOWED_SENDERS: 'feishu:user:ou_guest, discord:user:42' };
    expect(isSenderAllowed(dm, env)).toBe(true);
    expect(isSenderAllowed(group, env)).toBe(true);
    expect(isSenderAllowed({ platformKey: 'discord:thread:9', memoryKey: 'discord:user:42' }, env)).toBe(true);
    expect(isSenderAllowed({ platformKey: 'feishu:ou_other', memoryKey: 'feishu:user:ou_other' }, env)).toBe(false);
  });

  it('allows every member of a listed Feishu group, but only inside that group', () => {
    const env = { REMOTE_ALLOWED_SENDERS: 'feishu:chat:oc_team' };
    expect(isSenderAllowed(group, env)).toBe(true);
    expect(isSenderAllowed(topic, env)).toBe(true);
    expect(isSenderAllowed(dm, env)).toBe(false);
    expect(isSenderAllowed({ ...group, platformKey: 'feishu:group:oc_other:user:ou_guest' }, env)).toBe(false);
  });

  it('reports the sender key first and the group key second', () => {
    expect(senderKeys(group)).toEqual(['feishu:user:ou_guest', 'feishu:chat:oc_team']);
    expect(senderKeys(dm)).toEqual(['feishu:user:ou_guest']);
  });
});
