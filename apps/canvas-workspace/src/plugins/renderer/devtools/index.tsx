import { useLocation } from 'wouter';
import type { AgentDebugTrace } from '../../../renderer/src/types';
import type { RendererCanvasPlugin, RendererCtx } from '../../types';
import { AgentDebugPage } from './AgentDebugPage';
import { ChatDebugTrace } from './ChatDebugTrace';

// Read URL query off the wouter hash location (location is the path
// after '#', which may itself contain a '?<query>' suffix).
function parseQuery(location: string): URLSearchParams {
  const i = location.indexOf('?');
  return new URLSearchParams(i >= 0 ? location.slice(i + 1) : '');
}

const DebugRoute = ({ invoke }: { invoke: RendererCtx['invoke'] }) => {
  const [location, setLocation] = useLocation();
  const params = parseQuery(location);
  const sessionId = params.get('sessionId');
  const runId = params.get('runId');

  return (
    <AgentDebugPage
      invoke={invoke}
      selectedSessionId={sessionId}
      selectedRunId={runId}
      onSelectRun={(s, r) => {
        const q = new URLSearchParams({ sessionId: s, runId: r }).toString();
        setLocation(`/debug?${q}`);
      }}
      onBackToCanvas={() => setLocation('/')}
    />
  );
};

export const DevtoolsRendererPlugin: RendererCanvasPlugin = {
  id: 'devtools',
  activate(ctx) {
    ctx.registerRoute('/debug', () => <DebugRoute invoke={ctx.invoke} />);
    ctx.registerChatCard<AgentDebugTrace>({
      id: 'debug-trace',
      // Existing chat-stream code threads trace data onto the message
      // root as `debugTrace`. The card surfaces only when that field is
      // present on an assistant message.
      match: (message) => {
        if (message.role !== 'assistant') return null;
        return (message as { debugTrace?: AgentDebugTrace }).debugTrace ?? null;
      },
      Component: ({ payload }) => <ChatDebugTrace trace={payload} />,
    });
  },
};
