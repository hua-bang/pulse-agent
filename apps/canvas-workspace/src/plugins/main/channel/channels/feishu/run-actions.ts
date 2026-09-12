import { randomUUID } from 'node:crypto';
import type { FeishuCardActionEvent } from './feishu-channel';

interface StopAction {
  messageId: string;
  requesterId: string;
  stop: () => boolean;
}

/** Per-channel ephemeral controls. Never translate old buttons into /stop. */
export class FeishuRunActions {
  private readonly actions = new Map<string, StopAction>();
  token(): string { return randomUUID(); }
  register(token: string, action: StopAction): void { this.actions.set(token, action); }
  remove(token: string): void { this.actions.delete(token); }
  clear(): void { this.actions.clear(); }

  handle(data: unknown): object | null {
    if (!data || typeof data !== 'object') return null;
    const envelope = data as FeishuCardActionEvent;
    const event = envelope.event ?? envelope;
    const value = event.action?.value ?? event.action?.behaviors?.find(item => item.value)?.value;
    if (value?.action !== 'run.stop') return null;
    const action = typeof value.token === 'string' ? this.actions.get(value.token) : undefined;
    const messageId = event.open_message_id ?? event.message_id ?? event.context?.open_message_id ?? event.context?.message_id;
    const operator = event.operator?.open_id ?? event.operator?.operator_id?.open_id ?? event.open_id;
    const accepted = action && messageId === action.messageId && operator === action.requesterId && action.stop();
    return { toast: { type: accepted ? 'success' : 'info', content: accepted ? '正在停止此任务' : '此任务已结束、尚未开始，或你不是任务发起人' } };
  }
}
