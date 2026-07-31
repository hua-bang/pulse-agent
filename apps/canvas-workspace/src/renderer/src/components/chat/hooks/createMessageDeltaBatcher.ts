import type { Dispatch, SetStateAction } from 'react';
import type { AgentChatMessage } from '../../../types';
import { count } from '../../../perf/counters';
import type { SegmentState } from './relayTurnHandlers';
import { createTextDeltaBatcher } from './textDeltaBatcher';

export function createMessageDeltaBatcher(opts: {
  segment: SegmentState;
  setMessages: Dispatch<SetStateAction<AgentChatMessage[]>>;
  isCurrent: () => boolean;
}) {
  return createTextDeltaBatcher({
    schedule: callback => window.setTimeout(callback, 32),
    cancelScheduled: handle => window.clearTimeout(handle),
    onFlush: (delta) => {
      if (!opts.isCurrent()) return;
      count('chat-stream-commit');
      opts.setMessages(previous => {
        const index = opts.segment.msgIndex;
        if (index < 0 || index >= previous.length) return previous;
        const next = [...previous];
        next[index] = { ...next[index], content: next[index].content + delta };
        return next;
      });
    },
  });
}
