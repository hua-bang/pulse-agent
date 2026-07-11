import { waitFor } from './utils.mjs';

export class CdpClient {
  constructor(url) {
    this.url = url;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    this.eventWaiters = new Set();
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
      this.handleMessage(JSON.parse(String(event.data)));
    });
    this.socket.addEventListener('close', () => {
      const err = new Error(`CDP socket closed: ${this.url}`);
      this.failOutstanding(err);
      this.listeners.clear();
    });
  }

  failOutstanding(error) {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    for (const waiter of [...this.eventWaiters]) waiter.reject(error);
  }

  handleMessage(message) {
    if (message.id === undefined) {
      const listeners = this.listeners.get(message.method);
      if (!listeners) return;
      for (const listener of [...listeners]) {
        try {
          listener(message.params ?? {});
        } catch (err) {
          console.error(`[harness:cdp] ${message.method} listener failed`, err);
        }
      }
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    if (message.error) {
      pending.reject(new Error(`${message.error.message}${message.error.data ? `: ${message.error.data}` : ''}`));
    } else {
      pending.resolve(message.result ?? {});
    }
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) ?? new Set();
    listeners.add(listener);
    this.listeners.set(method, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(method);
    };
  }

  waitForEvent(method, timeoutMs = 15_000) {
    return new Promise((resolveEvent, rejectEvent) => {
      let timer;
      let unsubscribe = () => {};
      let settled = false;
      const cleanup = () => {
        clearTimeout(timer);
        unsubscribe();
        this.eventWaiters.delete(waiter);
      };
      const waiter = {
        reject: (error) => {
          if (settled) return;
          settled = true;
          cleanup();
          rejectEvent(error);
        },
      };
      unsubscribe = this.on(method, (params) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolveEvent(params);
      });
      this.eventWaiters.add(waiter);
      timer = setTimeout(() => {
        waiter.reject(new Error(`CDP event timed out after ${timeoutMs}ms: ${method}`));
      }, timeoutMs);
    });
  }

  send(method, params = {}, timeoutMs = 15_000) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('CDP socket is not open');
    }
    const id = this.nextId++;
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
      try {
        this.socket.send(JSON.stringify({ id, method, params }));
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        rejectSend(err);
      }
    });
  }

  close() {
    this.failOutstanding(new Error(`CDP client closed: ${this.url}`));
    if (this.socket && this.socket.readyState === WebSocket.OPEN) this.socket.close();
    this.listeners.clear();
  }
}

export async function getPageTarget(session) {
  const targets = await getTargets(session);
  const page = targets.find((target) =>
    target.type === 'page' &&
    target.webSocketDebuggerUrl &&
    !String(target.url ?? '').startsWith('devtools://')
  );
  if (!page) throw new Error('No renderer page target found.');
  return page;
}

export async function getTargets(session) {
  const res = await fetch(`http://127.0.0.1:${session.cdpPort}/json/list`);
  if (!res.ok) throw new Error(`CDP target list failed: HTTP ${res.status}`);
  return res.json();
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

export async function withTarget(target, fn) {
  if (!target?.webSocketDebuggerUrl) throw new Error('CDP target has no debugger WebSocket URL.');
  const cdp = new CdpClient(target.webSocketDebuggerUrl);
  await cdp.connect();
  try {
    return await fn(cdp, target);
  } finally {
    cdp.close();
  }
}
