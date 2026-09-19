import type { ToolCallStatus } from '../../../types';

export {
  friendlyChatFailure,
  type FriendlyChatFailure,
} from '../../../../../shared/chat-failure';

/** Settle tools in their original slots when a stream closes without a result. */
export function settleStreamTools(tools: ToolCallStatus[], stopped = false): void {
  for (const tool of tools) {
    if (tool.status !== 'running' && tool.status !== 'queued') continue;
    tool.status = stopped ? 'cancelled' : 'failed';
    tool.error = stopped ? 'cancelled' : 'no result';
    tool.inputStreaming = false;
    tool.finishedAt = Date.now();
  }
}
