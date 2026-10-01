import { AppBridge, PostMessageTransport } from '@modelcontextprotocol/ext-apps/app-bridge';

declare global {
  interface Window {
    hostCallTool: (params: unknown) => Promise<any>;
    hostEvents: any[];
    startHost: (html: string, toolInput: Record<string, unknown>, toolResult: any) => Promise<void>;
    bridge: AppBridge;
  }
}

window.hostEvents = [];
window.startHost = async (html, toolInput, toolResult) => {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('sandbox', 'allow-scripts');
  iframe.style.cssText = 'width:900px;height:640px;border:0;display:block';
  document.body.append(iframe);
  const bridge = new AppBridge(null, { name: 'e2e-host', version: '1' }, {
    serverTools: {}, openLinks: {}, logging: {}, updateModelContext: { text: {} },
  }, {
    hostContext: { theme: 'light', displayMode: 'inline', availableDisplayModes: ['inline', 'fullscreen'], platform: 'desktop' },
  });
  window.bridge = bridge;
  bridge.oncalltool = async params => {
    window.hostEvents.push({ type: 'call', name: (params as any).name });
    return window.hostCallTool(params);
  };
  bridge.onupdatemodelcontext = async params => { window.hostEvents.push({ type: 'context', params }); return {}; };
  bridge.onrequestdisplaymode = async ({ mode }) => {
    window.hostEvents.push({ type: 'display', mode });
    iframe.style.height = mode === 'fullscreen' ? '900px' : '640px';
    bridge.sendHostContextChange({ displayMode: mode });
    return { mode };
  };
  bridge.onopenlink = async params => { window.hostEvents.push({ type: 'link', params }); return {}; };
  bridge.onloggingmessage = params => window.hostEvents.push({ type: 'log', params });
  bridge.onsizechange = params => {
    window.hostEvents.push({ type: 'size', params });
    if (params.height) iframe.style.height = `${Math.min(params.height, 900)}px`;
  };
  bridge.oninitialized = () => {
    window.hostEvents.push({ type: 'initialized' });
    void bridge.sendToolInput({ arguments: toolInput });
    void bridge.sendToolResult(toolResult);
  };
  iframe.srcdoc = html;
  await bridge.connect(new PostMessageTransport(iframe.contentWindow!, iframe.contentWindow!));
};
