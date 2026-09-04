import type {
  CanvasMcpOAuthStatus,
  CanvasMcpServer,
  CanvasMcpServerHealth,
} from '../../../../../../types';
import { Button } from '../../../../../../components/ui';
import { HealthBadge, ToolsList } from '../ServerParts';

export interface ServerListView {
  servers: CanvasMcpServer[];
  statuses: Record<string, CanvasMcpServerHealth>;
  oauthStatuses: Record<string, CanvasMcpOAuthStatus>;
  expanded: Record<string, boolean>;
  busyTool: string | null;
  busyOAuth: string | null;
  busyReload: 'all' | string | null;
}

export interface ServerListActions {
  toggleExpanded: (key: string) => void;
  reload: (serverName: string) => void;
  connectOAuth: (serverName: string) => void;
  disconnectOAuth: (serverName: string) => void;
  edit: (server: CanvasMcpServer) => void;
  remove: (serverName: string) => void;
  toggleTool: (serverName: string, toolName: string, enabled: boolean) => void;
}

interface Props {
  view: ServerListView;
  actions: ServerListActions;
  t: (key: any, params?: any) => string;
}

export const ServerList = ({ view, actions, t }: Props) => (
  <ul className="cfg-list">
    {view.servers.map((server) => {
      const isOpen = !!view.expanded[server.name];
      const health = view.statuses[server.name];
      const connectLabel = view.busyReload === server.name
        ? t('mcpConfig.connecting')
        : health?.ok
          ? t('mcpConfig.reconnect')
          : health && !health.ok
            ? t('mcpConfig.retry')
            : t('mcpConfig.connect');
      const oauthConnected = !!view.oauthStatuses[server.name]?.connected;
      return (
        <li key={server.name} className="cfg-list-entry">
          <div className="cfg-list-item">
            <button
              type="button"
              className="cfg-expander"
              aria-expanded={isOpen}
              title={t(isOpen ? 'mcpConfig.collapseTools' : 'mcpConfig.expandTools')}
              onClick={() => actions.toggleExpanded(server.name)}
            >
              {isOpen ? '▾' : '▸'}
            </button>
            <div className="cfg-list-main">
              <div className="cfg-list-title">
                {server.name} <span className="cfg-tag">{server.transport}</span>
                {server.auth === 'oauth' && <span className="cfg-tag">oauth</span>}
                {server.auth === 'oauth' && (
                  <span className={`cfg-health ${oauthConnected ? 'cfg-health--ok' : 'cfg-health--unknown'}`}>
                    {oauthConnected ? t('mcpConfig.oauthConnected') : t('mcpConfig.oauthNotConnected')}
                  </span>
                )}
                <HealthBadge health={health} t={t} />
              </div>
              <div className="cfg-list-desc">
                {server.transport === 'stdio' ? server.command : server.url}
              </div>
            </div>
            <div className={`cfg-list-actions${server.auth === 'oauth' || view.busyReload === server.name ? ' cfg-list-actions--pinned' : ''}`}>
              {server.auth !== 'oauth' && (
                <Button variant="secondary" size="sm" onClick={() => actions.reload(server.name)} disabled={view.busyReload !== null || view.busyOAuth !== null}>
                  {connectLabel}
                </Button>
              )}
              {server.auth === 'oauth' && (
                <>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => oauthConnected ? actions.reload(server.name) : actions.connectOAuth(server.name)}
                    disabled={view.busyReload !== null || view.busyOAuth !== null}
                  >
                    {view.busyOAuth === server.name
                      ? t('mcpConfig.oauthConnecting')
                      : oauthConnected
                        ? connectLabel
                        : t('mcpConfig.oauthConnect')}
                  </Button>
                  {oauthConnected && (
                    <Button variant="secondary" size="sm" onClick={() => actions.disconnectOAuth(server.name)} disabled={view.busyReload !== null || view.busyOAuth !== null}>
                      {view.busyOAuth === server.name ? t('mcpConfig.oauthConnecting') : t('mcpConfig.oauthDisconnect')}
                    </Button>
                  )}
                </>
              )}
              <Button variant="secondary" size="sm" onClick={() => actions.edit(server)}>
                {t('mcpConfig.edit')}
              </Button>
              <Button variant="danger" size="sm" onClick={() => actions.remove(server.name)}>
                {t('mcpConfig.delete')}
              </Button>
            </div>
          </div>
          {isOpen && (
            <div className="cfg-tools">
              <ToolsList
                health={health}
                isBusy={(tool) => view.busyTool === `${server.name}::${tool}`}
                onToggle={(tool, enabled) => actions.toggleTool(server.name, tool, enabled)}
                t={t}
              />
            </div>
          )}
        </li>
      );
    })}
  </ul>
);
