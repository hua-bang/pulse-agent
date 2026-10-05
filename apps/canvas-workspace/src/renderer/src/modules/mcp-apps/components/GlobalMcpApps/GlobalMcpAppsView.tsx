import { useEffect, useMemo, useRef } from 'react';
import { ArrowClockwise, X } from '@phosphor-icons/react';
import { Button } from '../../../../components/ui';
import { useI18n } from '../../../../i18n';
import { McpAppFrame } from '../McpAppFrame';
import { useMcpAppEntrypoint } from '../useMcpAppEntrypoint';
import { GlobalMcpAppTile } from './GlobalMcpAppTile';
import {
  GLOBAL_MCP_APP_SCOPE,
  globalMcpAppKey,
  globalMcpAppsStore,
  type GlobalMcpAppTarget,
  type RunningGlobalMcpApp,
} from './globalMcpAppsStore';
import { useGlobalMcpApps } from './useGlobalMcpApps';
import './index.css';

interface PaneProps {
  app: RunningGlobalMcpApp;
  active: boolean;
  onClose: () => void;
}

const GlobalMcpAppPane = ({ app, active, onClose }: PaneProps) => {
  const { t } = useI18n();
  const { serverName, toolName, resourceUri, title } = app.listing;
  const target = useMemo(
    () => ({ serverName, toolName, resourceUri }),
    [resourceUri, serverName, toolName],
  );
  const entry = useMcpAppEntrypoint(GLOBAL_MCP_APP_SCOPE, target);

  return (
    <section
      className="global-mcp-app"
      hidden={!active}
      aria-label={title}
      data-mcp-app-key={app.key}
    >
      <header className="global-mcp-app__bar">
        <GlobalMcpAppTile title={title} seed={app.key} size={22} icon={app.listing.icon} />
        <h1 className="global-mcp-app__title">{title}</h1>
        <span className="global-mcp-app__meta">{t('mcpApp.global.source', { server: serverName })}</span>
        <span className="global-mcp-app__spacer" />
        <Button
          variant="icon"
          size="md"
          aria-label={t('mcpApp.global.reload')}
          title={t('mcpApp.global.reload')}
          onClick={() => globalMcpAppsStore.reload(app.key)}
        >
          <ArrowClockwise size={15} />
        </Button>
        <Button
          variant="icon"
          size="md"
          aria-label={t('mcpApp.global.close')}
          title={t('mcpApp.global.close')}
          onClick={onClose}
        >
          <X size={15} />
        </Button>
      </header>
      <div className="global-mcp-app__body">
        {entry.error ? (
          <div className="global-mcp-app__status">
            <span>{entry.error}</span>
            <Button size="sm" onClick={entry.retry}>{t('mcpApp.node.retry')}</Button>
          </div>
        ) : entry.app ? (
          <McpAppFrame
            embedded
            embeddedDisplayMode="fullscreen"
            instanceId={`global-app:${app.key}`}
            app={entry.app}
            args={{}}
            scope={GLOBAL_MCP_APP_SCOPE}
          />
        ) : (
          <div className="global-mcp-app__status">{t('mcpApp.node.opening', { title })}</div>
        )}
      </div>
    </section>
  );
};

interface Props {
  /** The app the route points at; null while another view is showing. */
  active: GlobalMcpAppTarget | null;
  /** Called after the active app is closed, so the route can move away. */
  onCloseActive: () => void;
}

/**
 * Hosts every opened OpenAI `global` entrypoint. Panes stay mounted while
 * hidden, so switching views or workspaces never reloads an app; only close
 * or reload tears an instance down.
 */
export const GlobalMcpAppsView = ({ active, onCloseActive }: Props) => {
  const { t } = useI18n();
  const { running, loaded } = useGlobalMcpApps();
  const activeKey = active ? globalMcpAppKey(active) : null;
  const activeRunning = Boolean(activeKey && running.some(app => app.key === activeKey));

  // A route can name an app that is not open yet (for example after a
  // reload of the window): open it once its listing is known. Only once per
  // route key, so closing the app does not reopen it before the route moves.
  const autoOpenedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!active || !activeKey) {
      autoOpenedKeyRef.current = null;
      return;
    }
    if (activeRunning || autoOpenedKeyRef.current === activeKey) return;
    const listing = globalMcpAppsStore.find(active);
    if (listing) {
      autoOpenedKeyRef.current = activeKey;
      globalMcpAppsStore.open(listing);
    } else if (!loaded) {
      void globalMcpAppsStore.refresh();
    }
  }, [active, activeKey, activeRunning, loaded]);

  return (
    <div className="global-mcp-apps">
      {running.map(app => (
        <GlobalMcpAppPane
          key={`${app.key}:${app.revision}`}
          app={app}
          active={app.key === activeKey}
          onClose={() => {
            globalMcpAppsStore.close(app.key);
            if (app.key === activeKey) onCloseActive();
          }}
        />
      ))}
      {active && !activeRunning && loaded && !globalMcpAppsStore.find(active) && (
        <div className="global-mcp-app__status">{t('mcpApp.global.unavailable')}</div>
      )}
    </div>
  );
};
