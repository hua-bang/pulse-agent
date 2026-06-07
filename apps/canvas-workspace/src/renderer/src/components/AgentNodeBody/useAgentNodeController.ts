import { useCallback, useEffect, useRef, useState } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import type { AgentNodeData, CanvasNode, FileNodeData } from '../../types';
import { getAgentCommand } from '../../config/agentRegistry';
import { TERMINAL_OPTIONS } from '../../config/terminalTheme';
import type { AgentNodeBodyProps, ViewMode } from './types';
import {
  SCROLLBACK_SAVE_INTERVAL,
  loadRecentCwds,
  pushRecentCwd,
  serializeBuffer,
} from './utils/terminal';

const mintSessionId = (nodeId: string): string =>
  `${nodeId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

interface MirrorTerminalCacheEntry {
  term: Terminal;
  fitAddon: FitAddon;
  disposeSubscriptions: () => void;
  lastUsed: number;
}

const MAX_MIRROR_TERMINALS = 12;
const MIRROR_TERMINAL_STASH_ID = 'agent-mirror-terminal-stash';
const mirrorTerminalCache = new Map<string, MirrorTerminalCacheEntry>();

const mirrorTerminalCacheKey = (workspaceId: string | undefined, nodeId: string, sessionId: string) =>
  `${workspaceId ?? 'local'}:${nodeId}:${sessionId}`;

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
  if (element && stash && element.parentElement !== stash) {
    stash.appendChild(element);
  }
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
    .sort((a, b) => a[1].lastUsed - b[1].lastUsed);
  for (const [key, entry] of entries.slice(0, mirrorTerminalCache.size - MAX_MIRROR_TERMINALS)) {
    disposeMirrorTerminal(entry);
    mirrorTerminalCache.delete(key);
  }
};

export const detectAgentView = (data: AgentNodeData): ViewMode => {
  if (data.viewMode === 'setup') return 'setup';
  if (data.viewMode === 'running') return 'running';
  if (data.viewMode === 'restart') return 'restart';
  const status = data.status ?? 'idle';
  const hasPriorSession =
    !!(data.sessionId && data.sessionId.length > 0)
    || !!(data.scrollback && data.scrollback.length > 0);
  if (hasPriorSession) return 'restart';
  if (status === 'running' || status === 'done' || status === 'error') return 'running';
  return 'setup';
};

const shouldAutoResume = (data: AgentNodeData): boolean => {
  if (data.status !== 'running') return false;
  if (data.viewMode !== 'running') return false;
  if (data.inlinePrompt?.trim() || data.promptFile?.trim()) return false;
  const hasPriorSession =
    !!(data.sessionId && data.sessionId.length > 0)
    || !!(data.scrollback && data.scrollback.length > 0);
  if (!hasPriorSession) return false;
  if (data.agentType === 'claude-code') return !!data.cliSessionId;
  if (data.agentType === 'codex') return true;
  return false;
};

export const useAgentNodeController = ({
  node,
  getAllNodes,
  rootFolder,
  workspaceId,
  onUpdate,
  readOnly = false,
  terminalMode = 'owner',
}: AgentNodeBodyProps) => {
  const data = node.data as AgentNodeData;
  const isMirrorTerminal = terminalMode === 'mirror';
  const isTeamManagedAgent = !!data.agentTeamId;
  const defaultCwd = data.cwd || (isTeamManagedAgent ? rootFolder || '' : '');
  const shouldResumeOnMount = !isMirrorTerminal && shouldAutoResume(data);
  const [selectedAgent, setSelectedAgent] = useState(data.agentType || 'claude-code');
  const [cwdInput, setCwdInput] = useState(defaultCwd);
  const [promptInput, setPromptInput] = useState(data.inlinePrompt || data.lastInitPrompt || '');
  const [dangerousMode, setDangerousMode] = useState(data.dangerousMode ?? isTeamManagedAgent);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [recentCwds, setRecentCwds] = useState<string[]>(loadRecentCwds);
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    if (isMirrorTerminal) return 'running';
    if (shouldResumeOnMount) return 'running';
    const hasPriorSession =
      !!(data.sessionId && data.sessionId.length > 0)
      || !!(data.scrollback && data.scrollback.length > 0);
    if (data.viewMode === 'running' && hasPriorSession) return 'restart';
    return detectAgentView(data);
  });
  const [fromRestart, setFromRestart] = useState(false);
  const [loading, setLoading] = useState(false);

  const pendingAgentRef = useRef(data.agentType || 'claude-code');
  const pendingCwdRef = useRef(data.cwd || '');
  const pendingPromptRef = useRef(data.inlinePrompt || '');
  const pendingResumeRef = useRef(shouldResumeOnMount);
  const needsAutoMintRef = useRef(shouldResumeOnMount);
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const spawnedRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const nodeIdRef = useRef(node.id);
  nodeIdRef.current = node.id;
  const dataRef = useRef(data);
  dataRef.current = data;
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;
  const getAllNodesRef = useRef(getAllNodes);
  getAllNodesRef.current = getAllNodes;

  useEffect(() => {
    if (readOnly || isMirrorTerminal || !isTeamManagedAgent) return;
    const nextCwd = data.cwd || rootFolder || '';
    const needsCwd = !!nextCwd && data.cwd !== nextCwd;
    const needsDangerousMode = data.dangerousMode !== true;
    if (!needsCwd && !needsDangerousMode) return;
    onUpdateRef.current(nodeIdRef.current, {
      data: {
        ...dataRef.current,
        cwd: needsCwd ? nextCwd : dataRef.current.cwd,
        dangerousMode: true,
      },
    });
  }, [data.cwd, data.dangerousMode, isMirrorTerminal, isTeamManagedAgent, readOnly, rootFolder]);

  useEffect(() => {
    if (!isTeamManagedAgent) return;
    const nextCwd = data.cwd || rootFolder || '';
    if (nextCwd && cwdInput !== nextCwd) setCwdInput(nextCwd);
    if (!dangerousMode) setDangerousMode(true);
  }, [cwdInput, dangerousMode, data.cwd, isTeamManagedAgent, rootFolder]);

  const reportAgentTeamOutput = useCallback((delta: string) => {
    const current = dataRef.current;
    if (!current.agentTeamId || readOnly || isMirrorTerminal || !workspaceId) return;
    const api = window.canvasWorkspace?.agentTeams;
    if (!api) return;
    void api.reportAgentOutput(workspaceId, nodeIdRef.current, delta);
  }, [isMirrorTerminal, readOnly, workspaceId]);

  const spawnAgent = useCallback(
    async (
      agentType: string,
      cwd: string,
      inlinePromptOverride: string | undefined,
      resumeMode: boolean,
      sessionId: string,
    ) => {
      if (!containerRef.current || termRef.current || spawnedRef.current) return;

      if (isMirrorTerminal) {
        spawnedRef.current = true;
        const activeSessionId = sessionId || dataRef.current.sessionId || nodeIdRef.current;
        const cacheKey = mirrorTerminalCacheKey(workspaceId, nodeIdRef.current, activeSessionId);
        let cached = mirrorTerminalCache.get(cacheKey);

        if (cached) {
          const cachedEntry = cached;
          cached.lastUsed = Date.now();
          containerRef.current.replaceChildren();
          const element = cachedEntry.term.element;
          if (element) containerRef.current.appendChild(element);
          termRef.current = cachedEntry.term;
          fitRef.current = cachedEntry.fitAddon;
          try { cachedEntry.fitAddon.fit(); } catch { /* ignore */ }
          try { cachedEntry.term.refresh(0, cachedEntry.term.rows - 1); } catch { /* ignore */ }
          requestAnimationFrame(() => {
            try { cachedEntry.fitAddon.fit(); } catch { /* ignore */ }
            try { cachedEntry.term.refresh(0, cachedEntry.term.rows - 1); } catch { /* ignore */ }
          });
          cleanupRef.current = () => detachMirrorTerminal(cachedEntry);
          return;
        }

        const term = new Terminal(TERMINAL_OPTIONS);
        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        containerRef.current.replaceChildren();
        term.open(containerRef.current);
        termRef.current = term;
        fitRef.current = fitAddon;

        cached = {
          term,
          fitAddon,
          disposeSubscriptions: () => undefined,
          lastUsed: Date.now(),
        };
        mirrorTerminalCache.set(cacheKey, cached);
        pruneMirrorTerminalCache(cacheKey);

        term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
          if (e.type === 'keydown' && e.key === '2' && (e.ctrlKey || e.metaKey) && !e.altKey) {
            setPickerOpen(true);
            return false;
          }
          return true;
        });

        try { fitAddon.fit(); } catch { /* ignore */ }
        requestAnimationFrame(() => {
          try { fitAddon.fit(); } catch { /* ignore */ }
        });

        const api = window.canvasWorkspace?.pty;
        if (!api) {
          term.writeln('\x1b[31mError: pty API not available (preload missing)\x1b[0m');
          cleanupRef.current = () => cached && detachMirrorTerminal(cached);
          return;
        }

        const cwdResult = await api.getCwd(activeSessionId);
        if (!cwdResult.ok) {
          const saved = dataRef.current.scrollback;
          if (!saved) {
            term.writeln('\x1b[2mNo live teammate terminal yet.\x1b[0m');
            term.writeln('\x1b[2mIt will appear here after the team runtime starts this agent.\x1b[0m');
          } else {
            term.writeln('\x1b[2m--- restored agent output ---\x1b[0m');
            term.write(saved.split('\n').join('\r\n'));
            term.writeln('');
            term.writeln('\x1b[2m--- live session is not connected ---\x1b[0m');
          }
          cleanupRef.current = () => cached && detachMirrorTerminal(cached);
          return;
        }

        const removeData = api.onData(activeSessionId, (d: string) => {
          term.write(d);
        });
        const removeExit = api.onExit(activeSessionId, (code: number) => {
          term.writeln(`\r\n\x1b[2m[Agent exited with code ${code}]\x1b[0m`);
        });
        const inputDisposable = readOnly
          ? { dispose: () => undefined }
          : term.onData((d: string) => {
            api.write(activeSessionId, d);
          });
        const resizeDisposable = term.onResize(({ cols, rows }) => {
          api.resize(activeSessionId, cols, rows);
        });

        let subscriptionsDisposed = false;
        cached.disposeSubscriptions = () => {
          if (subscriptionsDisposed) return;
          subscriptionsDisposed = true;
          removeData();
          removeExit();
          inputDisposable.dispose();
          resizeDisposable.dispose();
        };
        cleanupRef.current = () => cached && detachMirrorTerminal(cached);
        return;
      }

      if (readOnly) {
        spawnedRef.current = true;
        const term = new Terminal(TERMINAL_OPTIONS);
        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        containerRef.current.replaceChildren();
        term.open(containerRef.current);
        termRef.current = term;
        fitRef.current = fitAddon;
        const saved = dataRef.current.scrollback;
        if (saved) {
          term.writeln('\x1b[2m--- restored agent output ---\x1b[0m');
          term.write(saved.split('\n').join('\r\n'));
          term.writeln('');
        } else {
          term.writeln('\x1b[2m--- no saved agent output ---\x1b[0m');
        }
        requestAnimationFrame(() => {
          try { fitAddon.fit(); } catch { /* ignore */ }
        });
        return;
      }
      spawnedRef.current = true;
      setLoading(true);

      const term = new Terminal(TERMINAL_OPTIONS);
      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      containerRef.current.replaceChildren();
      term.open(containerRef.current);
      termRef.current = term;
      fitRef.current = fitAddon;

      term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
        if (e.type === 'keydown' && e.key === '2' && (e.ctrlKey || e.metaKey) && !e.altKey) {
          setPickerOpen(true);
          return false;
        }
        return true;
      });

      try { fitAddon.fit(); } catch { /* ignore */ }
      requestAnimationFrame(() => {
        try { fitAddon.fit(); } catch { /* ignore */ }
      });

      const api = window.canvasWorkspace?.pty;
      if (!api) {
        term.writeln('\x1b[31mError: pty API not available (preload missing)\x1b[0m');
        return;
      }

      const command = getAgentCommand(agentType);
      const existingCliSessionId = dataRef.current.cliSessionId;
      const cliSessionId = existingCliSessionId || crypto.randomUUID();
      const canResumeClaude = !!existingCliSessionId;
      const writeCommandTimeRef = { current: 0 };
      const writeCommand = () => {
        if (!command) {
          term.writeln(`\x1b[33mUnknown agent type: ${agentType}\x1b[0m`);
          setLoading(false);
          return;
        }
        writeCommandTimeRef.current = Date.now();

        const { inlinePrompt, promptFile, agentArgs, dangerousMode } = dataRef.current;
        const effectivePrompt = inlinePromptOverride || inlinePrompt;
        const dangerousFlag = dangerousMode
          ? agentType === 'claude-code'
            ? ' --dangerously-skip-permissions'
            : agentType === 'codex'
              ? ' --dangerously-bypass-approvals-and-sandbox'
              : ''
          : '';

        if (agentType === 'codex' && resumeMode && !effectivePrompt && !promptFile) {
          api.write(sessionId, `${command}${dangerousFlag} resume --last\n`);
        } else {
          const flags =
            (agentType === 'claude-code'
              ? ` ${resumeMode && canResumeClaude ? '--resume' : '--session-id'} ${cliSessionId}`
              : '') + dangerousFlag + (agentArgs ? ` ${agentArgs}` : '');
          if (effectivePrompt) {
            const escaped = effectivePrompt.replace(/'/g, "'\\''");
            api.write(sessionId, `${command}${flags} '${escaped}'\n`);
          } else if (promptFile) {
            api.write(sessionId, `__prompt=$(cat ${promptFile}) && ${command}${flags} "$__prompt"\n`);
          } else {
            api.write(sessionId, `${command}${flags}\n`);
          }
        }

        if (effectivePrompt || promptFile) {
          onUpdateRef.current(nodeIdRef.current, {
            data: {
              ...dataRef.current,
              inlinePrompt: '',
              promptFile: '',
              lastInitPrompt: effectivePrompt || dataRef.current.lastInitPrompt || '',
            },
          });
        }
      };

      let prompted = false;
      const removeDataRef: { current: (() => void) | null } = { current: null };
      const ECHO_WINDOW_MS = 300;
      const QUIESCENCE_MS = 500;
      const FAILSAFE_MS = 15_000;
      let loadingDismissed = false;
      let bannerStarted = false;
      let quiescenceTimer: ReturnType<typeof setTimeout> | null = null;
      const dismissLoading = () => {
        if (loadingDismissed) return;
        loadingDismissed = true;
        if (quiescenceTimer) {
          clearTimeout(quiescenceTimer);
          quiescenceTimer = null;
        }
        setLoading(false);
      };
      const scheduleQuiescence = () => {
        if (loadingDismissed) return;
        if (quiescenceTimer) clearTimeout(quiescenceTimer);
        quiescenceTimer = setTimeout(() => {
          quiescenceTimer = null;
          dismissLoading();
        }, QUIESCENCE_MS);
      };
      const loadingTimeout = setTimeout(dismissLoading, FAILSAFE_MS);

      const attachPermanentListener = () => {
        removeDataRef.current = api.onData(sessionId, (d: string) => {
          term.write(d);
          reportAgentTeamOutput(d);
          if (loadingDismissed) return;
          if (writeCommandTimeRef.current === 0) return;
          const since = Date.now() - writeCommandTimeRef.current;
          if (!bannerStarted) {
            if (since <= ECHO_WINDOW_MS) return;
            bannerStarted = true;
          }
          scheduleQuiescence();
        });
      };

      const promptRemove = api.onData(sessionId, (d: string) => {
        term.write(d);
        if (!prompted) {
          prompted = true;
          promptRemove();
          attachPermanentListener();
          setTimeout(writeCommand, 100);
        }
      });

      const removeExit = api.onExit(sessionId, (code: number) => {
        term.writeln(`\r\n\x1b[2m[Agent exited with code ${code}]\x1b[0m`);
        dismissLoading();
        const current = dataRef.current;
        if (current.agentTeamId && workspaceId) {
          void window.canvasWorkspace?.agentTeams?.reportAgentExit(workspaceId, nodeIdRef.current, code);
        }
        onUpdateRef.current(nodeIdRef.current, {
          data: { ...dataRef.current, status: 'done' },
        });
      });

      const spawnCwd = cwd || rootFolder || undefined;
      const currentData = dataRef.current;
      const result = await api.spawn(sessionId, term.cols, term.rows, spawnCwd, workspaceId, {
        PULSE_CANVAS_WORKSPACE_ID: workspaceId,
        PULSE_CANVAS_NODE_ID: nodeIdRef.current,
        PULSE_CANVAS_TEAM_ID: currentData.agentTeamId,
        PULSE_CANVAS_TEAM_AGENT_ID: currentData.agentTeamAgentId,
        PULSE_CANVAS_TEAM_ROLE: currentData.agentTeamRole,
      });
      if (!result.ok) {
        if (!prompted) promptRemove();
        removeDataRef.current?.();
        removeExit();
        clearTimeout(loadingTimeout);
        dismissLoading();
        term.writeln(`\x1b[31mFailed to spawn shell: ${result.error}\x1b[0m`);
        onUpdateRef.current(nodeIdRef.current, {
          data: { ...dataRef.current, status: 'error' },
        });
        return;
      }

      term.onData((d: string) => {
        api.write(sessionId, d);
      });

      term.onResize(({ cols, rows }) => { api.resize(sessionId, cols, rows); });

      onUpdateRef.current(nodeIdRef.current, {
        data: {
          ...dataRef.current,
          agentType,
          cwd: spawnCwd ?? '',
          status: 'running',
          sessionId,
          cliSessionId,
        },
      });

      saveTimerRef.current = setInterval(async () => {
        const scrollback = serializeBuffer(term);
        const cwdResult = await api.getCwd(sessionId);
        const curCwd = cwdResult.ok && cwdResult.cwd ? cwdResult.cwd : dataRef.current.cwd;
        onUpdateRef.current(nodeIdRef.current, {
          data: { ...dataRef.current, scrollback, cwd: curCwd },
        });
      }, SCROLLBACK_SAVE_INTERVAL);

      cleanupRef.current = () => {
        if (!prompted) promptRemove();
        removeDataRef.current?.();
        removeExit();
        clearTimeout(loadingTimeout);
        dismissLoading();
        api.kill(sessionId);
      };
    },
    [isMirrorTerminal, rootFolder, workspaceId, readOnly, reportAgentTeamOutput],
  );

  useEffect(() => {
    if (readOnly || isMirrorTerminal) return;
    if (viewMode === 'running') return;
    if (data.viewMode !== 'running' && data.status !== 'running') return;

    pendingAgentRef.current = data.agentType || 'claude-code';
    pendingCwdRef.current = data.cwd || rootFolder || '';
    pendingPromptRef.current = data.inlinePrompt || '';
    pendingResumeRef.current =
      !data.inlinePrompt?.trim()
      && !data.promptFile?.trim()
      && (
        (data.agentType === 'claude-code' && !!data.cliSessionId)
        || data.agentType === 'codex'
      );
    setViewMode('running');
  }, [
    data.agentType,
    data.cliSessionId,
    data.cwd,
    data.inlinePrompt,
    data.promptFile,
    data.status,
    data.viewMode,
    isMirrorTerminal,
    readOnly,
    rootFolder,
    viewMode,
  ]);

  const mirrorSessionId = isMirrorTerminal ? data.sessionId : undefined;
  useEffect(() => {
    if (viewMode === 'running' && !spawnedRef.current) {
      let runSessionId = dataRef.current.sessionId || nodeIdRef.current;
      if (!isMirrorTerminal && needsAutoMintRef.current) {
        needsAutoMintRef.current = false;
        const apiPty = window.canvasWorkspace?.pty;
        if (apiPty && runSessionId) apiPty.kill(runSessionId);
        runSessionId = mintSessionId(nodeIdRef.current);
        onUpdateRef.current(nodeIdRef.current, {
          data: { ...dataRef.current, sessionId: runSessionId, scrollback: '' },
        });
      }
      void spawnAgent(
        pendingAgentRef.current,
        pendingCwdRef.current,
        pendingPromptRef.current,
        pendingResumeRef.current,
        runSessionId,
      );
    }
    return () => {
      if (isMirrorTerminal) {
        cleanupRef.current?.();
        termRef.current = null;
        fitRef.current = null;
        spawnedRef.current = false;
        cleanupRef.current = null;
        setLoading(false);
        return;
      }
      const api = window.canvasWorkspace?.pty;
      if (termRef.current && api && viewMode === 'running') {
        const scrollback = serializeBuffer(termRef.current);
        const activeSessionId = dataRef.current.sessionId || nodeIdRef.current;
        void api.getCwd(activeSessionId).then((r) => {
          const cwd = r.ok && r.cwd ? r.cwd : dataRef.current.cwd;
          onUpdateRef.current(nodeIdRef.current, {
            data: { ...dataRef.current, scrollback, cwd },
          });
        });
      }
      if (saveTimerRef.current) clearInterval(saveTimerRef.current);
      cleanupRef.current?.();
      termRef.current?.dispose();
      containerRef.current?.replaceChildren();
      termRef.current = null;
      fitRef.current = null;
      spawnedRef.current = false;
      cleanupRef.current = null;
      setLoading(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, mirrorSessionId, isMirrorTerminal]);

  useEffect(() => {
    if (!fitRef.current) return;
    const observer = new ResizeObserver(() => {
      try { fitRef.current?.fit(); } catch { /* ignore */ }
    });
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [viewMode]);

  useEffect(() => {
    if (readOnly || isMirrorTerminal) return;
    if (dataRef.current.viewMode === viewMode) return;
    onUpdateRef.current(nodeIdRef.current, {
      data: { ...dataRef.current, viewMode },
    });
  }, [viewMode, isMirrorTerminal, readOnly]);

  const handleLaunch = useCallback(() => {
    if (readOnly || isMirrorTerminal) return;
    const effectiveCwd = cwdInput || dataRef.current.cwd || rootFolder || '';
    const prompt = promptInput.trim();
    const effectiveDangerousMode = dataRef.current.agentTeamId ? true : dangerousMode;
    pendingAgentRef.current = selectedAgent;
    pendingCwdRef.current = effectiveCwd;
    pendingPromptRef.current = prompt;
    pendingResumeRef.current = false;
    if (effectiveCwd) setRecentCwds(pushRecentCwd(effectiveCwd));
    const api = window.canvasWorkspace?.pty;
    const oldSessionId = dataRef.current.sessionId;
    if (api && oldSessionId) api.kill(oldSessionId);
    const freshSessionId = mintSessionId(nodeIdRef.current);
    const freshCliSessionId = crypto.randomUUID();
    onUpdateRef.current(nodeIdRef.current, {
      data: {
        ...dataRef.current,
        agentType: selectedAgent,
        cwd: effectiveCwd,
        inlinePrompt: prompt,
        lastInitPrompt: prompt || dataRef.current.lastInitPrompt || '',
        dangerousMode: effectiveDangerousMode,
        status: 'running',
        sessionId: freshSessionId,
        scrollback: '',
        cliSessionId: freshCliSessionId,
      },
    });
    setFromRestart(false);
    setViewMode('running');
  }, [selectedAgent, cwdInput, promptInput, dangerousMode, rootFolder, isMirrorTerminal, readOnly]);

  const handleMentionSelect = useCallback((selected: CanvasNode) => {
    if (readOnly) return;
    setPickerOpen(false);
    const api = window.canvasWorkspace?.pty;
    if (api) {
      const filePath = selected.type === 'file'
        ? (selected.data as FileNodeData).filePath
        : undefined;
      const label = filePath ? filePath.split('/').pop() : selected.title;
      const mention = `@[${label}](canvas:${selected.id})`;
      const activeSessionId = dataRef.current.sessionId || nodeIdRef.current;
      void api.write(activeSessionId, mention);
    }
    termRef.current?.focus();
  }, [readOnly]);

  const handleMentionClose = useCallback(() => {
    setPickerOpen(false);
    termRef.current?.focus();
  }, []);

  const handleRestartSession = useCallback(() => {
    if (readOnly || isMirrorTerminal) return;
    const savedAgent = data.agentType || selectedAgent;
    const savedCwd = data.cwd || rootFolder || '';
    const savedPrompt = data.lastInitPrompt || '';
    pendingAgentRef.current = savedAgent;
    pendingCwdRef.current = savedCwd;
    pendingPromptRef.current = savedPrompt;
    pendingResumeRef.current =
      !savedPrompt.trim()
      && (
        (savedAgent === 'claude-code' && !!dataRef.current.cliSessionId)
        || savedAgent === 'codex'
      );
    const api = window.canvasWorkspace?.pty;
    const oldSessionId = dataRef.current.sessionId;
    if (api && oldSessionId) api.kill(oldSessionId);
    const freshSessionId = mintSessionId(nodeIdRef.current);
    onUpdateRef.current(nodeIdRef.current, {
      data: {
        ...dataRef.current,
        agentType: savedAgent,
        cwd: savedCwd,
        inlinePrompt: savedPrompt,
        status: 'running',
        sessionId: freshSessionId,
        scrollback: '',
      },
    });
    setFromRestart(false);
    setViewMode('running');
  }, [data.agentType, data.cwd, data.lastInitPrompt, selectedAgent, rootFolder, isMirrorTerminal, readOnly]);

  const handleEditInit = useCallback(() => {
    if (readOnly || isMirrorTerminal) return;
    setSelectedAgent(data.agentType || selectedAgent);
    setCwdInput(data.cwd || '');
    setPromptInput(data.lastInitPrompt || '');
    setDangerousMode(data.dangerousMode ?? false);
    setFromRestart(true);
    setViewMode('setup');
  }, [data.agentType, data.cwd, data.lastInitPrompt, data.dangerousMode, selectedAgent, isMirrorTerminal, readOnly]);

  const handleBackToRestart = useCallback(() => {
    setFromRestart(false);
    setViewMode('restart');
  }, []);

  const handlePickFolder = useCallback(async () => {
    if (readOnly || isMirrorTerminal) return;
    const api = window.canvasWorkspace?.dialog;
    if (!api) return;
    const result = await api.openFolder();
    if (result.ok && !result.canceled && result.folderPath) {
      setCwdInput(result.folderPath);
    }
  }, [isMirrorTerminal, readOnly]);

  return {
    containerRef,
    cwdInput,
    data,
    fromRestart,
    handleBackToRestart,
    handleEditInit,
    handleLaunch,
    handleMentionClose,
    handleMentionSelect,
    handlePickFolder,
    handleRestartSession,
    loading,
    pickerOpen,
    promptInput,
    recentCwds,
    selectedAgent,
    setCwdInput,
    setPromptInput,
    setSelectedAgent,
    dangerousMode,
    setDangerousMode,
    status: data.status ?? 'idle',
    viewMode,
    visibleNodes: getAllNodesRef.current?.() ?? [],
  };
};
