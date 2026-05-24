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
}: AgentNodeBodyProps) => {
  const data = node.data as AgentNodeData;
  const [selectedAgent, setSelectedAgent] = useState(data.agentType || 'claude-code');
  const [cwdInput, setCwdInput] = useState(data.cwd || '');
  const [promptInput, setPromptInput] = useState(data.inlinePrompt || data.lastInitPrompt || '');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [recentCwds, setRecentCwds] = useState<string[]>(loadRecentCwds);
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    if (shouldAutoResume(data)) return 'running';
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
  const pendingResumeRef = useRef(shouldAutoResume(data));
  const needsAutoMintRef = useRef(shouldAutoResume(data));
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

  const spawnAgent = useCallback(
    async (
      agentType: string,
      cwd: string,
      inlinePromptOverride: string | undefined,
      resumeMode: boolean,
      sessionId: string,
    ) => {
      if (!containerRef.current || termRef.current || spawnedRef.current) return;

      if (readOnly) {
        spawnedRef.current = true;
        const term = new Terminal(TERMINAL_OPTIONS);
        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
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

        const { inlinePrompt, promptFile, agentArgs } = dataRef.current;
        const effectivePrompt = inlinePromptOverride || inlinePrompt;

        if (agentType === 'codex' && resumeMode) {
          api.write(sessionId, `${command} resume --last\n`);
        } else {
          const flags =
            agentType === 'claude-code'
              ? ` ${resumeMode && canResumeClaude ? '--resume' : '--session-id'} ${cliSessionId}`
              : '';
          if (effectivePrompt) {
            const escaped = effectivePrompt.replace(/'/g, "'\\''");
            api.write(sessionId, `${command}${flags} '${escaped}'\n`);
          } else if (promptFile) {
            api.write(sessionId, `__prompt=$(cat ${promptFile}) && ${command}${flags} "$__prompt"\n`);
          } else if (agentArgs) {
            api.write(sessionId, `${command}${flags} ${agentArgs}\n`);
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
        onUpdateRef.current(nodeIdRef.current, {
          data: { ...dataRef.current, status: 'done' },
        });
      });

      const spawnCwd = cwd || rootFolder || undefined;
      const result = await api.spawn(sessionId, term.cols, term.rows, spawnCwd, workspaceId);
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
    [rootFolder, workspaceId, readOnly],
  );

  useEffect(() => {
    if (viewMode === 'running' && !spawnedRef.current) {
      let runSessionId = dataRef.current.sessionId || nodeIdRef.current;
      if (needsAutoMintRef.current) {
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
      termRef.current = null;
      fitRef.current = null;
      spawnedRef.current = false;
      cleanupRef.current = null;
      setLoading(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode]);

  useEffect(() => {
    if (!fitRef.current) return;
    const observer = new ResizeObserver(() => {
      try { fitRef.current?.fit(); } catch { /* ignore */ }
    });
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [viewMode]);

  useEffect(() => {
    if (readOnly) return;
    if (dataRef.current.viewMode === viewMode) return;
    onUpdateRef.current(nodeIdRef.current, {
      data: { ...dataRef.current, viewMode },
    });
  }, [viewMode, readOnly]);

  const handleLaunch = useCallback(() => {
    if (readOnly) return;
    const effectiveCwd = cwdInput || rootFolder || '';
    const prompt = promptInput.trim();
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
        status: 'running',
        sessionId: freshSessionId,
        scrollback: '',
        cliSessionId: freshCliSessionId,
      },
    });
    setFromRestart(false);
    setViewMode('running');
  }, [selectedAgent, cwdInput, promptInput, rootFolder, readOnly]);

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
    if (readOnly) return;
    const savedAgent = data.agentType || selectedAgent;
    const savedCwd = data.cwd || rootFolder || '';
    const savedPrompt = data.lastInitPrompt || '';
    pendingAgentRef.current = savedAgent;
    pendingCwdRef.current = savedCwd;
    pendingPromptRef.current = savedPrompt;
    pendingResumeRef.current =
      (savedAgent === 'claude-code' && !!dataRef.current.cliSessionId)
      || savedAgent === 'codex';
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
  }, [data.agentType, data.cwd, data.lastInitPrompt, selectedAgent, rootFolder, readOnly]);

  const handleEditInit = useCallback(() => {
    if (readOnly) return;
    setSelectedAgent(data.agentType || selectedAgent);
    setCwdInput(data.cwd || '');
    setPromptInput(data.lastInitPrompt || '');
    setFromRestart(true);
    setViewMode('setup');
  }, [data.agentType, data.cwd, data.lastInitPrompt, selectedAgent, readOnly]);

  const handleBackToRestart = useCallback(() => {
    setFromRestart(false);
    setViewMode('restart');
  }, []);

  const handlePickFolder = useCallback(async () => {
    if (readOnly) return;
    const api = window.canvasWorkspace?.dialog;
    if (!api) return;
    const result = await api.openFolder();
    if (result.ok && !result.canceled && result.folderPath) {
      setCwdInput(result.folderPath);
    }
  }, [readOnly]);

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
    status: data.status ?? 'idle',
    viewMode,
    visibleNodes: getAllNodesRef.current?.() ?? [],
  };
};
