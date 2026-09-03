import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react';
import type { AppBridge } from '@modelcontextprotocol/ext-apps/app-bridge';
import type {
  CallToolResult,
  ListResourcesResult,
  ReadResourceResult,
} from '@modelcontextprotocol/sdk/types.js';
import type { AgentChatMcpApp, AgentScope } from '../../../../types';
import { serializeMcpAppToolArguments } from '../../../../../../shared/mcp-apps';
import { useRightDock, useRightDockMcpAppHost, useRightDockState } from '../../../../shared/dockPort';
import { mcpAppTabId } from '../../../../shared/dock/dock-tab-ids';
import { isDockTabPresented } from '../../../../shared/dock/dock-split-state';
import { useMcpAppApproval } from './useMcpAppApproval';
import { useMcpAppSurfacePlacement } from './useMcpAppSurfacePlacement';

export interface McpAppFrameProps {
  instanceId: string;
  app: AgentChatMcpApp;
  args?: unknown;
  fallbackResult?: string;
  scope: AgentScope;
}

type McpAppDisplayMode = 'inline' | 'fullscreen';

interface McpAppResource {
  html: string;
  csp: string;
}

export interface McpAppController {
  activateSurface: () => void;
  approval: ReturnType<typeof useMcpAppApproval>;
  connectBridge: () => Promise<void>;
  displayMode: McpAppDisplayMode;
  enterFullscreen: () => void;
  error?: string;
  expandButtonRef: RefObject<HTMLButtonElement>;
  height: number;
  iframeRef: RefObject<HTMLIFrameElement>;
  inlineHostRef: RefObject<HTMLDivElement>;
  resource?: McpAppResource;
  returnInline: () => void;
  surfaceRef: RefObject<HTMLDivElement>;
  title: string;
}

interface ResourceContent {
  uri?: string;
  mimeType?: string;
  text?: string;
  blob?: string;
  _meta?: unknown;
}

const MCP_APP_MIME_TYPE = 'text/html;profile=mcp-app';
const MCP_APP_HOST_EVENT = 'pulse-mcp-app-host-event';

function firstResource(value: unknown): ResourceContent | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const contents = (value as { contents?: unknown }).contents;
  return Array.isArray(contents) && contents[0] && typeof contents[0] === 'object'
    ? contents[0] as ResourceContent
    : undefined;
}

function resourceHtml(content: ResourceContent): string | undefined {
  if (typeof content.text === 'string') return content.text;
  if (typeof content.blob !== 'string') return undefined;
  try {
    const bytes = Uint8Array.from(atob(content.blob), char => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return undefined;
  }
}

function cspDomains(meta: unknown, key: 'connectDomains' | 'resourceDomains' | 'frameDomains'): string[] {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return [];
  const record = meta as Record<string, unknown>;
  const ui = record.ui;
  const uiCsp = ui && typeof ui === 'object' && !Array.isArray(ui)
    ? (ui as Record<string, unknown>).csp
    : undefined;
  const openAiCsp = record['openai/widgetCSP'];
  const source = uiCsp && typeof uiCsp === 'object' && !Array.isArray(uiCsp)
    ? uiCsp as Record<string, unknown>
    : openAiCsp && typeof openAiCsp === 'object' && !Array.isArray(openAiCsp)
      ? openAiCsp as Record<string, unknown>
      : {};
  const compatibilityKey = key.replace(/[A-Z]/g, match => `_${match.toLowerCase()}`);
  const values = source[key] ?? source[compatibilityKey];
  return Array.isArray(values)
    ? values.filter((value): value is string => (
      typeof value === 'string'
      && /^https:\/\/[a-z0-9*.-]+(?::\d+)?$/i.test(value)
    ))
    : [];
}

export function buildMcpAppCsp(meta?: unknown): string {
  const connect = cspDomains(meta, 'connectDomains');
  const resources = cspDomains(meta, 'resourceDomains');
  const frames = cspDomains(meta, 'frameDomains');
  const directive = (name: string, values: string[]) => `${name} ${values.length ? values.join(' ') : "'none'"}`;
  const csp = [
    "default-src 'none'",
    `script-src 'unsafe-inline' 'unsafe-eval' blob:${resources.length ? ` ${resources.join(' ')}` : ''}`,
    `style-src 'unsafe-inline'${resources.length ? ` ${resources.join(' ')}` : ''}`,
    `img-src data: blob:${resources.length ? ` ${resources.join(' ')}` : ''}`,
    `font-src data:${resources.length ? ` ${resources.join(' ')}` : ''}`,
    `media-src blob:${resources.length ? ` ${resources.join(' ')}` : ''}`,
    directive('connect-src', ['data:', ...connect]),
    `frame-src 'self'${frames.length ? ` ${frames.join(' ')}` : ''}`,
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
  return csp;
}

function callToolResult(value: unknown, fallbackResult = ''): CallToolResult {
  if (value && typeof value === 'object' && Array.isArray((value as { content?: unknown }).content)) {
    return value as CallToolResult;
  }
  return {
    content: fallbackResult ? [{ type: 'text', text: fallbackResult }] : [],
    ...(value && typeof value === 'object' ? { structuredContent: value as Record<string, unknown> } : {}),
  };
}

async function closeAppBridge(bridge: AppBridge): Promise<void> {
  try {
    await bridge.teardownResource({}, { timeout: 1_000 });
  } catch {
    // A view may not implement graceful teardown; transport close is final.
  }
  await bridge.close();
}

const mcpAppHostContext = (displayMode: McpAppDisplayMode, container?: HTMLElement | null) => ({
  theme: document.documentElement.classList.contains('dark') ? 'dark' as const : 'light' as const,
  displayMode,
  availableDisplayModes: ['inline', 'fullscreen'] as McpAppDisplayMode[],
  ...(container && container.clientWidth > 0 && container.clientHeight > 0
    ? { containerDimensions: { width: container.clientWidth, height: container.clientHeight } }
    : {}),
  locale: navigator.language,
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  platform: 'desktop' as const,
  userAgent: 'Pulse Canvas/0.1.0',
});

export const useMcpAppController = ({
  instanceId,
  app,
  args,
  fallbackResult,
  scope,
}: McpAppFrameProps): McpAppController => {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const expandButtonRef = useRef<HTMLButtonElement | null>(null);
  const inlineHostRef = useRef<HTMLDivElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const bridgeRef = useRef<AppBridge | null>(null);
  const displayModeRef = useRef<McpAppDisplayMode>('inline');
  const restoreInlineFocusRef = useRef(false);
  const [resource, setResource] = useState<McpAppResource>();
  const [error, setError] = useState<string>();
  const [height, setHeight] = useState(320);
  const [displayMode, setDisplayMode] = useState<McpAppDisplayMode>('inline');
  const approval = useMcpAppApproval();
  const dock = useRightDock();
  const dockState = useRightDockState();
  const dockHost = useRightDockMcpAppHost(instanceId);
  const dockTabId = mcpAppTabId(instanceId);
  const dockTabOpen = dockState.tabs.some(tab => tab.id === dockTabId);
  const dockTabVisible = dockTabOpen
    && dockState.expanded
    && isDockTabPresented(dockState.activeTabId, dockState.splitTabIds, dockTabId);

  const title = useMemo(() => `${app.toolName} MCP App`, [app.toolName]);
  const enterFullscreen = useCallback(() => {
    dock.openMcpApp(instanceId, title);
    displayModeRef.current = 'fullscreen';
    setDisplayMode('fullscreen');
  }, [dock, instanceId, title]);
  const returnInline = useCallback(() => {
    dock.closeMcpApp(instanceId);
    displayModeRef.current = 'inline';
    restoreInlineFocusRef.current = true;
    setDisplayMode('inline');
  }, [dock, instanceId]);
  const activateSurface = useCallback(() => {
    if (displayModeRef.current === 'fullscreen') dock.activateMcpApp(instanceId);
  }, [dock, instanceId]);

  useMcpAppSurfacePlacement({
    displayMode,
    dockHost,
    dockTabVisible,
    height,
    inlineHostRef,
    instanceId,
    resourceKey: resource,
    surfaceRef,
  });

  useEffect(() => {
    if (displayMode === 'fullscreen' && !dockTabOpen) {
      displayModeRef.current = 'inline';
      restoreInlineFocusRef.current = true;
      setDisplayMode('inline');
    }
  }, [displayMode, dockTabOpen]);

  useLayoutEffect(() => {
    if (displayMode === 'fullscreen' && dockTabVisible) {
      iframeRef.current?.focus({ preventScroll: true });
      return;
    }
    if (displayMode === 'inline' && restoreInlineFocusRef.current) {
      restoreInlineFocusRef.current = false;
      expandButtonRef.current?.focus({ preventScroll: true });
    }
  }, [displayMode, dockTabVisible]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (
        event.source !== iframeRef.current?.contentWindow
        || event.data?.type !== MCP_APP_HOST_EVENT
        || displayModeRef.current !== 'fullscreen'
      ) return;
      if (event.data?.action === 'escape') returnInline();
      if (event.data?.action === 'activate') dock.activateMcpApp(instanceId);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [dock, instanceId, returnInline]);

  useEffect(() => {
    const bridge = bridgeRef.current;
    const target = displayMode === 'fullscreen' ? dockHost : inlineHostRef.current;
    if (!bridge) return;
    bridge.setHostContext(mcpAppHostContext(displayMode, target));
    if (!target || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      bridge.setHostContext(mcpAppHostContext(displayMode, target));
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, [displayMode, dockHost]);

  useEffect(() => {
    let cancelled = false;
    const previousBridge = bridgeRef.current;
    bridgeRef.current = null;
    if (previousBridge) void closeAppBridge(previousBridge);
    setResource(undefined);
    setError(undefined);
    void window.canvasWorkspace.agent.mcpApps
      .readResource(scope, app.serverName, app.resourceUri)
      .then((result) => {
        if (cancelled) return;
        if (!result.ok) {
          setError(result.error ?? 'Failed to read MCP App resource');
          return;
        }
        const content = firstResource(result.value);
        if (content?.mimeType !== MCP_APP_MIME_TYPE) {
          setError('MCP App resource returned an unsupported MIME type');
          return;
        }
        const nextHtml = content && resourceHtml(content);
        if (!nextHtml) {
          setError('MCP App resource did not return HTML');
          return;
        }
        setResource({ html: nextHtml, csp: buildMcpAppCsp(content._meta) });
      });
    return () => { cancelled = true; };
  }, [app.resourceUri, app.serverName, scope]);

  useEffect(() => () => {
    const bridge = bridgeRef.current;
    bridgeRef.current = null;
    if (bridge) void closeAppBridge(bridge);
  }, []);

  useEffect(() => () => {
    dock.closeMcpApp(instanceId);
  }, [dock, instanceId]);

  const connectBridge = async () => {
    const frameWindow = iframeRef.current?.contentWindow;
    if (!frameWindow || bridgeRef.current) return;
    const { AppBridge, PostMessageTransport } = await import('@modelcontextprotocol/ext-apps/app-bridge');
    const bridge = new AppBridge(
      null,
      { name: 'Pulse Canvas', version: '0.1.0' },
      {
        serverTools: {},
        serverResources: {},
        logging: {},
      },
      {
        hostContext: {
          ...mcpAppHostContext(
            displayMode,
            displayMode === 'fullscreen' ? dockHost : inlineHostRef.current,
          ),
        },
      },
    );

    bridge.oncalltool = async ({ name, arguments: toolArgs }) => {
      if (name.length > 128 || !/^[a-zA-Z0-9_.-]+$/.test(name)) {
        return { isError: true, content: [{ type: 'text', text: 'Invalid MCP tool name' }] };
      }
      try {
        serializeMcpAppToolArguments(toolArgs);
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: error instanceof Error ? error.message : 'Invalid tool arguments' }],
        };
      }
      let result = await window.canvasWorkspace.agent.mcpApps.callTool(
        scope,
        app.serverName,
        name,
        toolArgs ?? {},
      );
      if (result.approval) {
        const decision = await approval.ask(result.approval);
        result = await window.canvasWorkspace.agent.mcpApps.callTool(
          scope,
          app.serverName,
          name,
          toolArgs ?? {},
          { requestId: result.approval.requestId, decision },
        );
      }
      return result.ok
        ? callToolResult(result.value)
        : { isError: true, content: [{ type: 'text', text: result.error ?? 'Tool call failed' }] };
    };
    bridge.onlistresources = async (params) => {
      if (params?.cursor && params.cursor.length > 1_024) throw new Error('Resource cursor is too long');
      const result = await window.canvasWorkspace.agent.mcpApps.listResources(scope, app.serverName, params?.cursor);
      if (!result.ok) throw new Error(result.error ?? 'Failed to list resources');
      return result.value as ListResourcesResult;
    };
    bridge.onreadresource = async ({ uri }) => {
      const result = await window.canvasWorkspace.agent.mcpApps.readResource(scope, app.serverName, uri);
      if (!result.ok) throw new Error(result.error ?? 'Failed to read resource');
      return result.value as ReadResourceResult;
    };
    bridge.onrequestdisplaymode = async ({ mode }) => {
      if (mode === 'fullscreen') enterFullscreen();
      if (mode === 'inline') returnInline();
      return { mode: mode === 'fullscreen' || mode === 'inline' ? mode : displayModeRef.current };
    };
    bridge.onrequestteardown = () => {
      returnInline();
      bridgeRef.current = null;
      void closeAppBridge(bridge);
      setError('MCP App closed');
    };
    bridge.onloggingmessage = ({ level, logger, data }) => {
      const method = level === 'error' ? 'error' : level === 'warning' ? 'warn' : 'info';
      console[method](`[mcp-app${logger ? `:${logger}` : ''}]`, data);
    };
    bridge.addEventListener('sizechange', ({ height: nextHeight }) => {
      if (typeof nextHeight === 'number' && Number.isFinite(nextHeight)) {
        setHeight(Math.max(120, Math.min(720, Math.ceil(nextHeight))));
      }
    });
    bridge.oninitialized = () => {
      void bridge.sendToolInput({
        arguments: args && typeof args === 'object'
          ? args as Record<string, unknown>
          : {},
      });
      void bridge.sendToolResult(callToolResult(app.result, fallbackResult));
    };

    bridgeRef.current = bridge;
    try {
      bridge.onsandboxready = () => {
        void bridge.sendSandboxResourceReady({ html: resource!.html });
      };
      const connecting = bridge.connect(new PostMessageTransport(frameWindow, frameWindow));
      frameWindow.postMessage({
        jsonrpc: '2.0',
        method: 'pulse/sandbox-probe',
        params: {},
      }, '*');
      await connecting;
    } catch (bridgeError) {
      bridgeRef.current = null;
      setError(bridgeError instanceof Error ? bridgeError.message : String(bridgeError));
      await closeAppBridge(bridge);
    }
  };

  return {
    activateSurface,
    approval,
    connectBridge,
    displayMode,
    enterFullscreen,
    error,
    expandButtonRef,
    height,
    iframeRef,
    inlineHostRef,
    resource,
    returnInline,
    surfaceRef,
    title,
  };
};
