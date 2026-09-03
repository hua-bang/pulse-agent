import { ArrowUUpLeft, ArrowsOutSimple } from '@phosphor-icons/react';
import { useI18n } from '../../../../i18n';
import { Button, Portal } from '../../../../components/ui';
import { McpAppApprovalDialog } from './McpAppApprovalDialog';
import {
  useMcpAppController,
  type McpAppFrameProps,
} from './useMcpAppController';
import './index.css';

export { buildMcpAppCsp } from './useMcpAppController';

export const McpAppFrame = (props: McpAppFrameProps) => {
  const controller = useMcpAppController(props);
  const { t } = useI18n();

  if (controller.error) {
    return <div className="chat-mcp-app chat-mcp-app--error">{controller.error}</div>;
  }
  if (!controller.resource) {
    return <div className="chat-mcp-app chat-mcp-app--loading">Loading MCP App…</div>;
  }

  return (
    <div className="chat-mcp-app" data-display-mode={controller.displayMode}>
      <div
        ref={controller.inlineHostRef}
        className="chat-mcp-app__inline-host"
        style={{ height: controller.displayMode === 'inline' ? controller.height : 0 }}
      />
      <Portal>
        <div
          ref={controller.surfaceRef}
          className="chat-mcp-app__surface"
          data-display-mode={controller.displayMode}
          onMouseDown={controller.activateSurface}
          onFocusCapture={controller.activateSurface}
        >
          <iframe
            ref={controller.iframeRef}
            title={controller.title}
            src={`pulse-mcp-app://sandbox/index.html?csp=${encodeURIComponent(controller.resource.csp)}`}
            sandbox="allow-scripts allow-same-origin"
            style={{ height: '100%' }}
            onLoad={() => { void controller.connectBridge(); }}
          />
          {controller.displayMode === 'inline' && (
            <Button
              ref={controller.expandButtonRef}
              variant="icon"
              size="lg"
              className="chat-mcp-app__display-action"
              aria-label={t('mcpApp.openInDock')}
              title={t('mcpApp.openInDock')}
              onClick={controller.enterFullscreen}
            >
              <ArrowsOutSimple size={15} />
            </Button>
          )}
        </div>
      </Portal>
      {controller.displayMode === 'fullscreen' && (
        <Button size="sm" className="chat-mcp-app__return-inline" onClick={controller.returnInline}>
          <ArrowUUpLeft size={15} />
          <span>{t('mcpApp.openInDockStatus', { title: controller.title })}</span>
        </Button>
      )}
      <McpAppApprovalDialog
        request={controller.approval.request}
        onDecision={controller.approval.answer}
      />
    </div>
  );
};
