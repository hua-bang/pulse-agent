import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Mailbox } from '../mailbox.js';

describe('Mailbox', () => {
  let dir: string;
  let mailbox: Mailbox;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mailbox-test-'));
    mailbox = new Mailbox(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('should send and receive a message', () => {
    const msg = mailbox.send('alice', 'bob', 'message', 'Hello Bob');
    expect(msg.from).toBe('alice');
    expect(msg.to).toBe('bob');
    expect(msg.content).toBe('Hello Bob');
    expect(msg.read).toBe(false);

    const unread = mailbox.readUnread('bob');
    expect(unread).toHaveLength(1);
    expect(unread[0].content).toBe('Hello Bob');
  });

  it('should mark messages as read after readUnread', () => {
    mailbox.send('alice', 'bob', 'message', 'Hello');

    const first = mailbox.readUnread('bob');
    expect(first).toHaveLength(1);

    const second = mailbox.readUnread('bob');
    // Direct messages should be marked read
    expect(second).toHaveLength(0);
  });

  it('should return empty array when no messages', () => {
    const unread = mailbox.readUnread('nobody');
    expect(unread).toHaveLength(0);
  });

  it('should broadcast to multiple recipients', () => {
    const msgs = mailbox.broadcast('lead', ['a', 'b', 'c'], 'Team update');
    expect(msgs).toHaveLength(3);

    const aMessages = mailbox.readUnread('a');
    expect(aMessages).toHaveLength(1);
    expect(aMessages[0].content).toBe('Team update');
  });

  it('should not broadcast to sender', () => {
    const msgs = mailbox.broadcast('lead', ['lead', 'a', 'b'], 'Update');
    expect(msgs).toHaveLength(2);
  });

  it('should count unread messages', () => {
    mailbox.send('alice', 'bob', 'message', 'Msg 1');
    mailbox.send('charlie', 'bob', 'message', 'Msg 2');
    expect(mailbox.unreadCount('bob')).toBe(2);

    mailbox.readUnread('bob');
    expect(mailbox.unreadCount('bob')).toBe(0);
  });

  it('should clear messages for a recipient', () => {
    mailbox.send('alice', 'bob', 'message', 'Hello');
    mailbox.clear('bob');
    expect(mailbox.readAll('bob')).toHaveLength(0);
  });

  it('should read all messages including read ones', () => {
    mailbox.send('alice', 'bob', 'message', 'Msg 1');
    mailbox.readUnread('bob'); // marks as read
    mailbox.send('charlie', 'bob', 'message', 'Msg 2');

    const all = mailbox.readAll('bob');
    expect(all).toHaveLength(2);
  });
});
