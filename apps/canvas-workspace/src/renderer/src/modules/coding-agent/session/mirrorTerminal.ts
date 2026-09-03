import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { TERMINAL_OPTIONS } from '../../../config/terminalTheme';
import { scheduleTerminalFit } from '../components/AgentNodeBody/utils/terminal';

interface MirrorPtyApi {
  getCwd: (sessionId: string) => Promise<{ ok: boolean }>;
  onData: (sessionId: string, listener: (data: string) => void) => () => void;
  onExit: (sessionId: string, listener: (code: number) => void) => () => void;
  write: (sessionId: string, data: string) => unknown;
  resize: (sessionId: string, cols: number, rows: number) => unknown;
}

interface MirrorTerminalCacheEntry {
  term: Terminal;
  fitAddon: FitAddon;
  disposeSubscriptions: () => void;
  lastUsed: number;
}

export interface MirrorTerminalMount {
  term: Terminal;
  fitAddon: FitAddon;
  dispose: () => void;
}

interface MountMirrorTerminalOptions {
  container: HTMLElement;
  workspaceId?: string;
  nodeId: string;
  sessionId: string;
  readOnly: boolean;
  getSavedScrollback: () => string | undefined;
  onKeyEvent: (event: KeyboardEvent) => boolean;
  pty: MirrorPtyApi | undefined;
}

const RETRY_MIRROR_CONNECTION_MS = 1_000;
const MAX_MIRROR_TERMINALS = 12;
const MIRROR_TERMINAL_STASH_ID = 'agent-mirror-terminal-stash';
const mirrorTerminalCache = new Map<string, MirrorTerminalCacheEntry>();

const mirrorTerminalCacheKey = (
  workspaceId: string | undefined,
  nodeId: string,
  sessionId: string,
) => `${workspaceId ?? 'local'}:${nodeId}:${sessionId}`;

const getMirrorTerminalStash = (): HTMLElement | null => {
  if (typeof document === 'undefined') return null;
  let stash = document.getElementById(MIRROR_TERMINAL_STASH_ID);
  if (stash) return stash;
  stash = document.createElement('div');
  stash.id = MIRROR_TERMINAL_STASH_ID;
  stash.style.display = 'none';
  document.body.appendChild(stash);
  return stash;
};

const detachMirrorTerminal = (entry: MirrorTerminalCacheEntry) => {
  const element = entry.term.element;
  const stash = getMirrorTerminalStash();
  if (element && stash && element.parentElement !== stash) stash.appendChild(element);
};

const disposeMirrorTerminal = (entry: MirrorTerminalCacheEntry) => {
  entry.disposeSubscriptions();
  entry.term.dispose();
  entry.term.element?.remove();
};

const pruneMirrorTerminalCache = (activeKey: string) => {
  if (mirrorTerminalCache.size <= MAX_MIRROR_TERMINALS) return;
  const entries = [...mirrorTerminalCache.entries()]
    .filter(([key]) => key !== activeKey)
    .sort((left, right) => left[1].lastUsed - right[1].lastUsed);
  for (const [key, entry] of entries.slice(0, mirrorTerminalCache.size - MAX_MIRROR_TERMINALS)) {
    disposeMirrorTerminal(entry);
    mirrorTerminalCache.delete(key);
  }
};

/**
 * Mounts a read-through view of a team-owned PTY. The returned disposer is
 * available before the first async liveness probe settles, so unmounting can
 * never install late subscriptions on a disposed xterm.
 */
export const mountMirrorTerminal = ({
  container,
  workspaceId,
  nodeId,
  sessionId,
  readOnly,
  getSavedScrollback,
  onKeyEvent,
  pty,
}: MountMirrorTerminalOptions): MirrorTerminalMount => {
  const cacheKey = mirrorTerminalCacheKey(workspaceId, nodeId, sessionId);
  const cached = mirrorTerminalCache.get(cacheKey);
  if (cached) {
    cached.lastUsed = Date.now();
    container.replaceChildren();
    if (cached.term.element) container.appendChild(cached.term.element);
    scheduleTerminalFit(cached.fitAddon, cached.term, container);
    return {
      term: cached.term,
      fitAddon: cached.fitAddon,
      dispose: () => detachMirrorTerminal(cached),
    };
  }

  const term = new Terminal(TERMINAL_OPTIONS);
  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  container.replaceChildren();
  term.open(container);
  term.attachCustomKeyEventHandler(onKeyEvent);
  scheduleTerminalFit(fitAddon, term, container);

  let liveEntry: MirrorTerminalCacheEntry | null = null;
  let retryTimer: ReturnType<typeof setInterval> | null = null;
  let disposed = false;
  let restoredSavedOutput = false;

  const stopRetry = () => {
    if (!retryTimer) return;
    clearInterval(retryTimer);
    retryTimer = null;
  };

  const dispose = () => {
    disposed = true;
    stopRetry();
    if (liveEntry) detachMirrorTerminal(liveEntry);
    else {
      term.dispose();
      term.element?.remove();
    }
  };

  if (!pty) {
    term.writeln('\x1b[31mError: pty API not available (preload missing)\x1b[0m');
    return { term, fitAddon, dispose };
  }

  const attachLiveMirror = () => {
    if (disposed || liveEntry) return;
    stopRetry();
    liveEntry = { term, fitAddon, disposeSubscriptions: () => undefined, lastUsed: Date.now() };
    mirrorTerminalCache.set(cacheKey, liveEntry);
    pruneMirrorTerminalCache(cacheKey);

    if (!restoredSavedOutput) term.clear();
    let wroteLivePlaceholder = true;
    term.writeln('\x1b[2mConnected to live teammate terminal. New output will stream here.\x1b[0m');
    scheduleTerminalFit(fitAddon, term, container);

    const removeData = pty.onData(sessionId, (data) => {
      if (wroteLivePlaceholder && !restoredSavedOutput) term.clear();
      wroteLivePlaceholder = false;
      term.write(data);
    });
    const removeExit = pty.onExit(sessionId, (code) => {
      term.writeln(`\r\n\x1b[2m[Agent exited with code ${code}]\x1b[0m`);
    });
    const inputDisposable = readOnly
      ? { dispose: () => undefined }
      : term.onData((data) => { pty.write(sessionId, data); });
    const resizeDisposable = term.onResize(({ cols, rows }) => {
      pty.resize(sessionId, cols, rows);
    });
    let subscriptionsDisposed = false;
    liveEntry.disposeSubscriptions = () => {
      if (subscriptionsDisposed) return;
      subscriptionsDisposed = true;
      removeData();
      removeExit();
      inputDisposable.dispose();
      resizeDisposable.dispose();
    };
  };

  const restoreSavedOutput = () => {
    if (restoredSavedOutput) return;
    const saved = getSavedScrollback();
    if (!saved) return;
    restoredSavedOutput = true;
    term.clear();
    term.writeln('\x1b[2m--- restored agent output ---\x1b[0m');
    term.write(saved.split('\n').join('\r\n'));
    term.writeln('');
    term.writeln('\x1b[2m--- waiting for live session to reconnect ---\x1b[0m');
    scheduleTerminalFit(fitAddon, term, container);
  };

  const retryLiveMirror = async () => {
    if (disposed || liveEntry) return;
    const result = await pty.getCwd(sessionId);
    if (disposed || liveEntry) return;
    if (result.ok) attachLiveMirror();
    else restoreSavedOutput();
  };

  void pty.getCwd(sessionId).then((result) => {
    if (disposed) return;
    if (result.ok) {
      attachLiveMirror();
      return;
    }
    restoreSavedOutput();
    if (!restoredSavedOutput) {
      term.writeln('\x1b[2mNo live teammate terminal yet.\x1b[0m');
      term.writeln('\x1b[2mWaiting for the team runtime to connect this agent.\x1b[0m');
    }
    retryTimer = setInterval(() => { void retryLiveMirror(); }, RETRY_MIRROR_CONNECTION_MS);
  });

  return { term, fitAddon, dispose };
};
