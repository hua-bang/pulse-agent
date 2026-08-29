const DEFAULT_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "font-src data:",
  "media-src blob:",
  "connect-src 'none'",
  "frame-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

const SANDBOX_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>MCP App Sandbox</title></head>
<body style="margin:0;background:transparent">
<script>(() => {
  const inner = document.createElement('iframe');
  inner.style.cssText = 'display:block;width:100%;height:100vh;border:0;background:transparent';
  inner.setAttribute('sandbox', 'allow-scripts allow-forms');
  document.body.appendChild(inner);
  const proxyReady = 'ui/notifications/sandbox-proxy-ready';
  const resourceReady = 'ui/notifications/sandbox-resource-ready';
  const hostControls = "<script data-pulse-mcp-app-host-controls>(()=>{const send=action=>window.parent.postMessage({type:'pulse-mcp-app-host-event',action},'*');window.addEventListener('keydown',event=>{if(event.key==='Escape')send('escape')},true);window.addEventListener('pointerdown',()=>send('activate'),true);window.addEventListener('focusin',()=>send('activate'),true)})();<\\/script>";
  const notifyReady = () => window.parent.postMessage({ jsonrpc: '2.0', method: proxyReady, params: {} }, '*');
  window.addEventListener('message', (event) => {
    if (event.source === window.parent) {
      if (event.data?.method === resourceReady) {
        if (typeof event.data.params?.html === 'string') inner.srcdoc = event.data.params.html + hostControls;
      } else if (event.data?.method === 'pulse/sandbox-probe') {
        notifyReady();
      } else {
        inner.contentWindow?.postMessage(event.data, '*');
      }
      return;
    }
    if (event.source === inner.contentWindow && event.origin === 'null') {
      window.parent.postMessage(event.data, '*');
    }
  });
  notifyReady();
})();</script>
</body></html>`;

export function createMcpAppSandboxResponse(requestUrl: string): Response {
  const url = new URL(requestUrl);
  const requested = url.searchParams.get('csp');
  const csp = requested
    && requested.length <= 4_096
    && !/[\r\n]/.test(requested)
    ? requested
    : DEFAULT_CSP;
  return new Response(SANDBOX_HTML, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': csp,
      'Cache-Control': 'no-store',
    },
  });
}
