// Builds the init script that installs a window.canvasWorkspace stub before
// the real renderer bundle boots in plain Chromium. Concrete store/pluginFlags
// answers + a logging "magic mock" Proxy for everything else (calls resolve to
// {ok:false}, onX subscriptions return unsubscribe no-ops).

export const buildInitScript = (fixture) => `(() => {
  const FIXTURE = ${JSON.stringify(fixture)};
  const calls = [];
  window.__stubCalls = calls;
  const logCall = (path) => { if (calls.length < 2000) calls.push(path); };

  const makeMagic = (path) => {
    const fn = (...args) => {
      logCall(path);
      if (/\\.on[A-Z]/.test(path)) return () => {};
      return Promise.resolve({ ok: false });
    };
    return new Proxy(fn, {
      get(_t, prop) {
        if (prop === 'then' || typeof prop === 'symbol') return undefined;
        return makeMagic(path + '.' + String(prop));
      },
      apply(_t, _this, args) { return fn(...args); },
    });
  };

  const store = {
    load: async (id) => {
      logCall('store.load:' + id);
      if (id === '__workspaces__') {
        return { ok: true, data: { workspaces: [{ id: 'bench', name: 'Bench' }], folders: [], activeId: 'bench' } };
      }
      if (id === 'bench') return { ok: true, data: FIXTURE };
      return { ok: false };
    },
    save: async () => ({ ok: true }),
    list: async () => ({ ids: ['bench'] }),
    delete: async () => ({ ok: true }),
    getDir: async () => ({ ok: true, dir: '/tmp/bench' }),
    exportWorkspace: async () => ({ ok: false }),
    importWorkspace: async () => ({ ok: false }),
    listPollutedWorkspaces: async () => ({ ok: true, workspaces: [] }),
    watchWorkspace: async () => ({ ok: true }),
    onExternalUpdate: () => () => {},
    onMigrationProgress: () => () => {},
  };

  const base = {
    version: '0.0.0-bench',
    pluginFlags: {},
    store,
  };

  window.canvasWorkspace = new Proxy(base, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (typeof prop === 'symbol') return undefined;
      return makeMagic('canvasWorkspace.' + String(prop));
    },
    has() { return true; },
  });

  // Buffered long-task capture from t=0 (mount window, before __pulsePerf.begin).
  window.__benchLongTasks = [];
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) window.__benchLongTasks.push({ start: Math.round(e.startTime), dur: Math.round(e.duration) });
    }).observe({ type: 'longtask', buffered: true });
  } catch {}
  window.__benchErrors = [];
  window.addEventListener('error', (e) => { if (window.__benchErrors.length < 50) window.__benchErrors.push(String(e.message)); });
  window.addEventListener('unhandledrejection', (e) => { if (window.__benchErrors.length < 50) window.__benchErrors.push('rejection: ' + String(e.reason && e.reason.message || e.reason)); });
})();`;
