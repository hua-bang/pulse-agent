import type {
  CanvasMcpOAuthStatus,
  CanvasMcpServer,
  CanvasMcpServerHealth,
} from '../../../../../../types';
import { HealthBadge, ToolsList } from '../ServerParts';

interface Props {
  servers: CanvasMcpServer[];
  localServerNames: ReadonlySet<string>;
  statuses: Record<string, CanvasMcpServerHealth>;
  oauthStatuses: Record<string, CanvasMcpOAuthStatus>;
  expanded: Record<string, boolean>;
  onToggleExpanded: (key: string) => void;
  t: (key: any, params?: any) => string;
}

export const InheritedServerList = ({
  servers,
  localServerNames,
  statuses,
  oauthStatuses,
  expanded,
  onToggleExpanded,
  t,
}: Props) => (
  <div className="cfg-inherited">
    <div className="cfg-inherited-header">
      <span className="cfg-inherited-title">
        {t('mcpConfig.inheritedTitle', { count: servers.length })}
      </span>
      <span className="cfg-inherited-manage">{t('mcpConfig.inheritedManage')}</span>
    </div>
    <ul className="cfg-list cfg-list--scrollable">
      {servers.map((server) => {
        const overridden = localServerNames.has(server.name);
        const expandKey = `global::${server.name}`;
        const isOpen = !!expanded[expandKey];
        const oauthConnected = !!oauthStatuses[server.name]?.connected;
        return (
          <li key={server.name} className="cfg-list-entry">
            <div className={`cfg-list-item cfg-list-item--readonly${overridden ? ' cfg-list-item--shadowed' : ''}`}>
              <button
                type="button"
                className="cfg-expander"
                aria-expanded={isOpen}
                title={t(isOpen ? 'mcpConfig.collapseTools' : 'mcpConfig.expandTools')}
                onClick={() => onToggleExpanded(expandKey)}
              >
                {isOpen ? '▾' : '▸'}
              </button>
              <div className="cfg-list-main">
                <div className="cfg-list-title">
                  {server.name} <span className="cfg-tag">{server.transport}</span>
                  {server.auth === 'oauth' && <span className="cfg-tag">oauth</span>}
                  <span className="cfg-tag">global</span>
                  {server.auth === 'oauth' && (
                    <span className={`cfg-health ${oauthConnected ? 'cfg-health--ok' : 'cfg-health--unknown'}`}>
                      {oauthConnected
                        ? t('mcpConfig.oauthConnected')
                        : t('mcpConfig.oauthNotConnected')}
                    </span>
                  )}
                  <HealthBadge health={statuses[server.name]} t={t} />
                </div>
                <div className="cfg-list-desc">
                  {server.transport === 'stdio' ? server.command : server.url}
                </div>
              </div>
              {overridden && (
                <span
                  className="cfg-shadow-warn"
                  title={t('mcpConfig.inheritedOverridden')}
                >
                  ⚠ {t('mcpConfig.inheritedOverridden')}
                </span>
              )}
            </div>
            {isOpen && (
              <div className="cfg-tools">
                <ToolsList health={statuses[server.name]} readOnly t={t} />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  </div>
);
