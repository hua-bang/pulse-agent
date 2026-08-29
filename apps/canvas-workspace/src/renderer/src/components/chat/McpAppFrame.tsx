import { useEffect, useMemo, useRef, useState } from 'react';
import { AppBridge, PostMessageTransport } from '@modelcontextprotocol/ext-apps/app-bridge';
import type {
  CallToolResult,
  ListResourcesResult,
  ReadResourceResult,
} from '@modelcontextprotocol/sdk/types.js';
import type { AgentChatMcpApp, AgentScope } from '../../types';
import type { ToolCallStatus } from './types';
import { useMcpAppsHost } from './McpAppsContext';
import { serializeMcpAppToolArguments } from '../../../../shared/mcp-apps';

interface McpAppFrameProps {
  app: AgentChatMcpApp;
  args?: unknown;
  fallbackResult?: string;
  scope: AgentScope;
}

interface ResourceContent {
  uri?: string;
  mimeType?: string;
  text?: string;
  blob?: string;
  _meta?: unknown;
}

const MCP_APP_MIME_TYPE = 'text/html;profile=mcp-app';

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
    directive('connect-src', connect),
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

export const McpAppFrame = ({ app, args, fallbackResult, scope }: McpAppFrameProps) => {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const bridgeRef = useRef<AppBridge | null>(null);
  const [resource, setResource] = useState<{ html: string; csp: string }>();
  const [error, setError] = useState<string>();
  const [height, setHeight] = useState(320);

  const title = useMemo(() => `${app.toolName} MCP App`, [app.toolName]);

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

  const connectBridge = async () => {
    const frameWindow = iframeRef.current?.contentWindow;
    if (!frameWindow || bridgeRef.current) return;
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
          theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
          displayMode: 'inline',
          availableDisplayModes: ['inline'],
          locale: navigator.language,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          platform: 'desktop',
          userAgent: 'Pulse Canvas/0.1.0',
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
      const result = await window.canvasWorkspace.agent.mcpApps.callTool(
        scope,
        app.serverName,
        name,
        toolArgs ?? {},
      );
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
    bridge.onrequestdisplaymode = async () => ({ mode: 'inline' });
    bridge.onrequestteardown = () => {
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

  if (error) {
    return <div className="chat-mcp-app chat-mcp-app--error">{error}</div>;
  }
  if (!resource) {
    return <div className="chat-mcp-app chat-mcp-app--loading">Loading MCP App…</div>;
  }
  return (
    <div className="chat-mcp-app">
      <iframe
        ref={iframeRef}
        title={title}
        src={`pulse-mcp-app://sandbox/index.html?csp=${encodeURIComponent(resource.csp)}`}
        sandbox="allow-scripts allow-same-origin"
        style={{ height }}
        onLoad={() => { void connectBridge(); }}
      />
    </div>
  );
};

export const McpAppFrames = ({ tools }: { tools: ToolCallStatus[] }) => {
  const host = useMcpAppsHost();
  if (!host) return null;
  return <>{tools.filter(tool => tool.status === 'succeeded' && tool.mcpApp).map(tool => (
    <McpAppFrame
      key={`mcp-app-${tool.toolCallId ?? tool.id}`}
      app={tool.mcpApp!}
      args={tool.args}
      fallbackResult={tool.result}
      scope={host.scope}
    />
  ))}</>;
};
