import { describe, expect, it, vi } from 'vitest';
import { FeishuRunActions } from '../run-actions';

describe('Feishu turn-scoped stop actions', () => {
  it('requires the original user and message, then invalidates the token on cleanup', () => {
    const actions = new FeishuRunActions(); const stop = vi.fn(() => true);
    const token = actions.token();
    actions.register(token, { messageId: 'reply-a', requesterId: 'user-a', stop });
    const event = { context: { open_message_id: 'reply-a' }, operator: { open_id: 'user-a' }, action: { value: { action: 'run.stop', token } } };
    actions.handle({ ...event, context: { open_message_id: 'reply-b' } });
    actions.handle({ ...event, operator: { open_id: 'user-b' } });
    expect(stop).not.toHaveBeenCalled();
    expect(actions.handle({ event })).toEqual({ toast: { type: 'success', content: '正在停止此任务' } });
    expect(stop).toHaveBeenCalledOnce();
    actions.remove(token); actions.handle(event); expect(stop).toHaveBeenCalledOnce();
  });

  it('clears all controls at channel shutdown and ignores unrelated actions', () => {
    const actions = new FeishuRunActions(); const stop = vi.fn(() => true);
    actions.register('token', { messageId: 'reply', requesterId: 'user', stop });
    actions.clear();
    actions.handle({ open_message_id: 'reply', open_id: 'user', action: { value: { action: 'run.stop', token: 'token' } } });
    expect(stop).not.toHaveBeenCalled();
    expect(actions.handle(null)).toBeNull();
    expect(actions.handle({ action: { value: { action: 'workspace.use' } } })).toBeNull();
  });
});
