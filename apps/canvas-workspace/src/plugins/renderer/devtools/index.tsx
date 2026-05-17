import { useLocation } from 'wouter';
import { SettingsIcon } from '../../../renderer/src/components/icons';
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
  const runId = parseQuery(location).get('runId');

  return (
    <AgentDebugPage
      invoke={invoke}
      selectedRunId={runId}
      onSelectRun={(r) =>
        setLocation(`/debug?${new URLSearchParams({ runId: r }).toString()}`)
      }
      onBackToCanvas={() => setLocation('/')}
    />
  );
};

interface RunRef {
  runId: string;
}

const FLAG_ID = 'canvas-agent-debug-trace';

export const DevtoolsRendererPlugin: RendererCanvasPlugin = {
  id: 'devtools',
  enabledWhen: () =>
    (globalThis as { canvasWorkspace?: { pluginFlags?: Record<string, boolean> } })
      .canvasWorkspace?.pluginFlags?.[FLAG_ID] === true,
  activate(ctx) {
    ctx.registerRoute('/debug', () => <DebugRoute invoke={ctx.invoke} />);
    ctx.registerNavItem({
      id: 'devtools',
      path: '/debug',
      label: 'DevTools',
      title: 'Canvas Agent DevTools',
      icon: SettingsIcon,
    });
    ctx.registerChatCard<RunRef, AgentDebugTrace>({
      id: 'debug-trace',
      // Assistant messages carry only a runId pointer; the trace is
      // stored separately in the plugin's own store and fetched on
      // demand. Match returns the pointer; the framework drives the
      // resolve → render cycle.
      match: (message) => {
        if (message.role !== 'assistant') return null;
        const runId = (message as { runId?: string }).runId;
        return runId ? { runId } : null;
      },
      resolve: async (ref) => {
        const detail = await ctx.invoke<{ trace: AgentDebugTrace }>('get-run', ref.runId);
        return detail.trace;
      },
      Component: ({ payload }) => <ChatDebugTrace trace={payload} />,
    });
  },
};
