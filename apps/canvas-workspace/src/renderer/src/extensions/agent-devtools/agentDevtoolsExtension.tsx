import type { CanvasExtension } from '../../core/extensions';
import { SettingsIcon } from '../../components/icons';
import { AgentDebugPage } from './debug/AgentDebugPage';
import { ChatDebugTrace } from './ChatDebugTrace';

export const ROUTE_AGENT_DEVTOOLS = '/debug';
export const VIEW_AGENT_DEVTOOLS = 'agent-devtools';

export const agentDevtoolsExtension: CanvasExtension = {
  id: 'agent-devtools',
  name: 'Agent DevTools',
  devOnly: true,
  activate(ctx) {
    ctx.routes.register({
      id: 'agent-devtools.route',
      path: ROUTE_AGENT_DEVTOOLS,
      view: VIEW_AGENT_DEVTOOLS,
      keepWorkbenchMounted: true,
      render: ({ params, navigation }) => (
        <AgentDebugPage
          selectedSessionId={params.get('sessionId')}
          selectedRunId={params.get('runId')}
          onSelectRun={(sessionId, runId) => {
            const nextParams = new URLSearchParams();
            if (sessionId) nextParams.set('sessionId', sessionId);
            if (runId) nextParams.set('runId', runId);
            const query = nextParams.toString();
            navigation.open(query ? `${ROUTE_AGENT_DEVTOOLS}?${query}` : ROUTE_AGENT_DEVTOOLS);
          }}
          onBackToCanvas={() => navigation.open('/')}
        />
      ),
    });

    ctx.chat.registerMessageAddon({
      id: 'agent-devtools.chat-debug-trace',
      shouldRender: ({ message }) => Boolean(message.debugTrace),
      render: ({ message }) => message.debugTrace ? <ChatDebugTrace trace={message.debugTrace} /> : null,
    });

    ctx.sidebar.registerNavItem({
      id: 'agent-devtools.sidebar',
      view: VIEW_AGENT_DEVTOOLS,
      label: 'DevTools',
      title: 'Canvas Agent DevTools',
      icon: <SettingsIcon size={14} />,
      onSelect: navigation => navigation.open(ROUTE_AGENT_DEVTOOLS),
    });
  },
};
