import { Button } from '../../../renderer/src/components/ui';
import { useI18n } from '../../../renderer/src/i18n';
import { loadErrorDetail } from '../../../renderer/src/platform/browser/load-error';
import { useEmbeddedBrowser } from '../../../renderer/src/platform/browser/useEmbeddedBrowser';
import { useWebviewRegistration } from '../../../renderer/src/modules/canvas/webview';
import {
  DEFAULT_PLUGIN_PAGE_VIEW_ID,
  PLUGIN_PAGE_WORKSPACE_ID,
  isPluginPagePart,
  pluginPageTargetId,
} from '../../../shared/webview-registration';
import type { PluginWebViewProps } from '../../types';
import './index.css';

/**
 * Host-owned `<webview>` for a plugin page. The host keeps the login in the
 * `persist:plugin-<id>` partition, registers the guest so the agent and the
 * plugin can read the page and the selection, and shows load failures. The
 * plugin only chooses the URL. The registry loads this module on first use.
 */
export default function PluginWebView({
  pluginId,
  src,
  viewId,
  className,
  style,
  onNavigate,
  onTitleChange,
}: PluginWebViewProps & { pluginId: string }) {
  const { t } = useI18n();
  const resolvedViewId = isPluginPagePart(viewId) ? viewId : DEFAULT_PLUGIN_PAGE_VIEW_ID;
  const browser = useEmbeddedBrowser({
    className: 'plugin-webview__guest',
    partition: `persist:plugin-${pluginId}`,
    url: src,
    onNavigate,
    onTitleChange,
  });
  useWebviewRegistration({
    webview: browser.webview,
    workspaceId: PLUGIN_PAGE_WORKSPACE_ID,
    nodeId: pluginPageTargetId({ pluginId, viewId: resolvedViewId }),
    enabled: true,
    surfaceKind: 'plugin-page',
  });

  return (
    <div className={className ? `plugin-webview ${className}` : 'plugin-webview'} style={style}>
      <div ref={browser.hostRef} className="plugin-webview__host" />
      {browser.loadState === 'failed' && (
        <div className="plugin-webview__error" role="alert">
          <strong>{t('pluginWebView.loadFailed')}</strong>
          <span>{loadErrorDetail(browser.loadError)}</span>
          <Button size="sm" onClick={browser.reload}>{t('pluginWebView.retry')}</Button>
        </div>
      )}
    </div>
  );
}
