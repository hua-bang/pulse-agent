import { EventEmitter } from 'events';
import type { AgentEvent, AgentTurn } from '../types';

class CanvasAgentBus extends EventEmitter {
  emitTurn(event: AgentEvent, turn: AgentTurn): void {
    this.emit(event, turn);
  }
}

// Shared bus between canvas-agent (emitter) and plugin subscribers.
// canvas-agent calls agentBus.emitTurn(...) at its lifecycle points; plugins
// subscribe via MainCtx.onAgent.
export const agentBus = new CanvasAgentBus();
