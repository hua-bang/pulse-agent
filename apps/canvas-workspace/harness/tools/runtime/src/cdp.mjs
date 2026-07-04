import { waitFor } from './utils.mjs';

export class CdpClient {
  constructor(url) {
    this.url = url;
    this.nextId = 1;
    this.pending = new Map();
    this.socket = null;
  }

  async connect() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolveOpen, rejectOpen) => {
      const timer = setTimeout(() => rejectOpen(new Error('Timed out connecting to CDP WebSocket')), 10_000);
      this.socket.addEventListener('open', () => {
        clearTimeout(timer);
        resolveOpen();
      }, { once: true });
      this.socket.addEventListener('error', () => {
        clearTimeout(timer);
        rejectOpen(new Error(`Could not connect to CDP WebSocket: ${this.url}`));
      }, { once: true });
    });

    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(`${message.error.message}${message.error.data ? `: ${message.error.data}` : ''}`));
      } else {
        pending.resolve(message.result ?? {});
      }
    });
  }

  send(method, params = {}, timeoutMs = 15_000) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('CDP socket is not open');
    }
    const id = this.nextId++;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolveSend, rejectSend) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectSend(new Error(`CDP command timed out after ${timeoutMs}ms: ${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolveSend(value);
        },
        reject: (err) => {
          clearTimeout(timer);
          rejectSend(err);
        },
      });
    });
  }

  close() {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) this.socket.close();
  }
}

export async function getPageTarget(session) {
  const res = await fetch(`http://127.0.0.1:${session.cdpPort}/json/list`);
  if (!res.ok) throw new Error(`CDP target list failed: HTTP ${res.status}`);
  const targets = await res.json();
  const page = targets.find((target) =>
    target.type === 'page' &&
    target.webSocketDebuggerUrl &&
    !String(target.url ?? '').startsWith('devtools://')
  );
  if (!page) throw new Error('No renderer page target found.');
  return page;
}

export async function waitForPageTarget(session, timeoutMs) {
  return waitFor(() => getPageTarget(session), timeoutMs);
}

export async function withPage(session, fn) {
  const target = await getPageTarget(session);
  const cdp = new CdpClient(target.webSocketDebuggerUrl);
  await cdp.connect();
  try {
    return await fn(cdp, target);
  } finally {
    cdp.close();
  }
}
