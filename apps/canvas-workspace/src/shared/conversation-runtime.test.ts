import { describe, expect, it } from 'vitest';
import {
  conversationKey,
  conversationKeyId,
  InMemoryConversationRuntime,
  type ConversationKey,
} from './conversation-runtime';
import type { AgentScope } from './agent-chat';

const workspaceA: AgentScope = { kind: 'workspace', workspaceId: 'ws-a' };
const keyA: ConversationKey = conversationKey(workspaceA, 'session-a');
const keyB: ConversationKey = conversationKey(workspaceA, 'session-b');

describe('conversationKey', () => {
  it('derives storeId from the single scope→store mapping', () => {
    expect(keyA.storeId).toBe('ws-a');
    expect(keyA.sessionId).toBe('session-a');
  });

  it('yields a stable, collision-safe string id', () => {
    expect(conversationKeyId(keyA)).toBe('ws-a\u0000session-a');
    expect(conversationKeyId(keyA)).not.toBe(conversationKeyId(keyB));
  });
});

describe('ConversationRuntime invariants', () => {
  it('keeps two conversations in one workspace fully independent', () => {
    const a = new InMemoryConversationRuntime(keyA);
    const b = new InMemoryConversationRuntime(keyB);

    expect(a.send({ message: 'hello from A' })).toBe(true);
    expect(b.send({ message: 'hello from B' })).toBe(true);

    expect(a.getSnapshot().messages.map(m => m.content)).toEqual(['hello from A']);
    expect(b.getSnapshot().messages.map(m => m.content)).toEqual(['hello from B']);

    a.finish({ messages: [{ role: 'assistant', content: 'reply A', timestamp: 0 }] });
    expect(b.getSnapshot().messages.map(m => m.content)).toEqual(['hello from B']);
  });

  it('rejects a second turn while the same conversation is running', () => {
    const a = new InMemoryConversationRuntime(keyA);
    expect(a.send({ message: 'first' })).toBe(true);
    expect(a.send({ message: 'second' })).toBe(false);
  });

  it('allows two different conversations to run concurrently', () => {
    const a = new InMemoryConversationRuntime(keyA);
    const b = new InMemoryConversationRuntime(keyB);
    expect(a.send({ message: 'A' })).toBe(true);
    expect(b.send({ message: 'B' })).toBe(true);
    expect(a.getSnapshot().status).toBe('running');
    expect(b.getSnapshot().status).toBe('running');
  });

  it('aborts one conversation without touching another', () => {
    const a = new InMemoryConversationRuntime(keyA);
    const b = new InMemoryConversationRuntime(keyB);
    a.send({ message: 'A' });
    b.send({ message: 'B' });

    expect(a.abort()).toBe(true);
    expect(a.getSnapshot().status).toBe('idle');
    expect(b.getSnapshot().status).toBe('running');
    expect(b.getSnapshot().runId).not.toBeNull();
  });

  it('returns fresh snapshot arrays so a held reference never mutates', () => {
    const a = new InMemoryConversationRuntime(keyA);
    a.send({ message: 'first' });
    const snapshot = a.getSnapshot();
    const messagesBefore = snapshot.messages;

    a.finish({ messages: [{ role: 'assistant', content: 'done', timestamp: 0 }] });
    expect(messagesBefore).toEqual([expect.objectContaining({ content: 'first' })]);
    expect(snapshot.messages.length).toBe(1);
  });

  it('disposing one runtime does not affect another', () => {
    const a = new InMemoryConversationRuntime(keyA);
    const b = new InMemoryConversationRuntime(keyB);
    a.send({ message: 'A' });
    a.dispose();

    expect(b.send({ message: 'B' })).toBe(true);
    expect(b.getSnapshot().messages.length).toBe(1);
  });

  it('increments sequence monotonically on every published change', () => {
    const a = new InMemoryConversationRuntime(keyA);
    expect(a.getSnapshot().sequence).toBe(0);
    a.send({ message: 'x' });
    const s1 = a.getSnapshot().sequence;
    a.finish({ messages: [{ role: 'assistant', content: 'y', timestamp: 0 }] });
    const s2 = a.getSnapshot().sequence;
    expect(s2).toBeGreaterThan(s1);
  });

  it('isolates clarification between conversations', () => {
    const a = new InMemoryConversationRuntime(keyA);
    const b = new InMemoryConversationRuntime(keyB);
    const request = { id: 'req-1', question: 'confirm?' };

    a.setClarification(request);
    expect(a.getSnapshot().clarification?.id).toBe('req-1');
    expect(b.getSnapshot().clarification).toBeNull();

    expect(a.answerClarification('req-1', 'yes')).toBe(true);
    expect(a.getSnapshot().clarification).toBeNull();
    expect(b.answerClarification('req-1', 'yes')).toBe(false);
  });

  it('notifies subscribers on change and unsubscribes cleanly', () => {
    const a = new InMemoryConversationRuntime(keyA);
    let notified = 0;
    const unsubscribe = a.subscribe(() => { notified += 1; });
    a.send({ message: 'x' });
    expect(notified).toBe(1);
    unsubscribe();
    a.finish({ messages: [{ role: 'assistant', content: 'y', timestamp: 0 }] });
    expect(notified).toBe(1);
  });
});
