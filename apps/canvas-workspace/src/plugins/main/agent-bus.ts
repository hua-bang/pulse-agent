import { EventEmitter } from 'events';
import type {
  AgentObservabilitySubscriber,
  AgentTraceEvent,
} from '../../shared/agent-observability';
import type { AgentEvent, AgentTurn } from '../types';
import { AgentObservabilityBus } from './agent-observability-bus';

class CanvasAgentBus extends EventEmitter {
  emitTurn(event: AgentEvent, turn: AgentTurn): void {
    this.emit(event, turn);
  }

  // Fire-and-await: invoke every listener for the event and resolve when
  // all returned promises have settled. Used by callers that need to know
  // plugin handlers have finished (e.g. canvas-agent waits for devtools
  // to persist a trace before returning the chat response, so the chat
  // card can fetch it synchronously after the turn ends).
  async emitTurnAsync(event: AgentEvent, turn: AgentTurn): Promise<void> {
    const listeners = this.listeners(event) as Array<(turn: AgentTurn) => unknown>;
    if (listeners.length === 0) return;
    const results = await Promise.allSettled(listeners.map((fn) => fn(turn)));
    for (const r of results) {
      if (r.status === 'rejected') {
        console.error('[canvas-plugins] agentBus listener rejected', r.reason);
      }
    }
  }
}

// Shared bus between canvas-agent (emitter) and plugin subscribers.
// canvas-agent calls agentBus.emitTurn(...) or emitTurnAsync(...) at its
// lifecycle points; plugins subscribe via MainCtx.onAgent.
export const agentBus = new CanvasAgentBus();
export const agentObservabilityBus = new AgentObservabilityBus();

export const publishAgentTraceEvent = (event: AgentTraceEvent): void => {
  agentObservabilityBus.publish(event);
};

export const subscribeAgentTrace = (
  subscriber: AgentObservabilitySubscriber,
): (() => void) => agentObservabilityBus.subscribe(subscriber);

export const drainAgentTraceEvents = async (): Promise<void> => {
  await agentObservabilityBus.drain();
};
