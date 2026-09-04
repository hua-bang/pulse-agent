import { useCallback, useEffect, useRef, useState } from 'react';
import type { FitAddon } from '@xterm/addon-fit';
import type { Terminal } from '@xterm/xterm';
import type { AgentNodeData, CanvasNode } from '../../../../types';
import { getAgentCommand } from '../../../../config/agentRegistry';
import { buildNodeMentionInsertion } from '../../../../utils/nodeMention';
import { handleTerminalShortcut } from '../../../../shortcuts/terminalShortcuts';
import {
  getCodingAgentResumeBinding,
  resolveCodingAgentView,
  shouldAutoResumeCodingAgentSession,
} from '../../session/sessionLifecycle';
import { mountMirrorTerminal } from '../../session/mirrorTerminal';
import { mountOwnerTerminal, mountReadonlyTerminal } from '../../session/ownerTerminal';
import {
  useAgentSessionActivation,
  type AgentSessionActivationIntent,
} from '../../session/useAgentSessionActivation';
import { useCodexSessionRecovery } from '../../session/useCodexSessionRecovery';
import { createTerminalKeyArbiter } from './utils/terminalFocus';
import type { AgentNodeBodyProps, ViewMode } from './types';
import {
  createDebouncedTerminalRefit,
  fitTerminalIfSane,
  loadRecentCwds,
  pushRecentCwd,
  syncTerminalFontSizeToCanvas,
} from './utils/terminal';

const mintSessionId = (nodeId: string): string => `${nodeId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const DEFAULT_AGENT_TYPE = 'claude-code';
const normalizeAgentType = (agentType?: string): string =>
  agentType && getAgentCommand(agentType) ? agentType : DEFAULT_AGENT_TYPE;
export const useAgentNodeController = ({
  node,
  getAllNodes,
  rootFolder,
  workspaceId,
  onUpdate,
  readOnly = false,
  terminalMode = 'owner',
  forceTeamWarmup = false,
}: AgentNodeBodyProps) => {
  const rawData = node.data as AgentNodeData;
  const data = forceTeamWarmup && rawData.agentTeamId
    ? {
      ...rawData,
      status: 'running' as const,
      viewMode: 'running' as const,
      inlinePrompt: '',
      promptFile: '',
      agentTeamWarmup: true,
    }
    : rawData;
  const isMirrorTerminal = terminalMode === 'mirror';
  const isTeamManagedAgent = !!data.agentTeamId;
  const defaultCwd = data.cwd || (isTeamManagedAgent ? rootFolder || '' : '');
  const shouldResumeOnMount = !isMirrorTerminal && !isTeamManagedAgent
    && shouldAutoResumeCodingAgentSession(data);
  const [selectedAgent, setSelectedAgent] = useState(normalizeAgentType(data.agentType));
  const [cwdInput, setCwdInput] = useState(defaultCwd);
  const [promptInput, setPromptInput] = useState(data.inlinePrompt || data.lastInitPrompt || '');
  const [dangerousMode, setDangerousMode] = useState(data.dangerousMode ?? isTeamManagedAgent);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [recentCwds, setRecentCwds] = useState<string[]>(loadRecentCwds);
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    if (isMirrorTerminal) return 'running';
    if (shouldResumeOnMount) return 'running';
    if (isTeamManagedAgent && (data.viewMode === 'running' || data.status === 'running')) return 'restart';
    const hasPriorSession =
      !!(data.sessionId && data.sessionId.length > 0)
      || !!(data.scrollback && data.scrollback.length > 0);
    if (data.viewMode === 'running' && hasPriorSession) return 'restart';
    return resolveCodingAgentView(data);
  });
  const [fromRestart, setFromRestart] = useState(false);
  const [loading, setLoading] = useState(false);
  const [launchErrorCommand, setLaunchErrorCommand] = useState<string | null>(null);

  const pendingAgentRef = useRef(normalizeAgentType(data.agentType));
  const pendingCwdRef = useRef(data.cwd || '');
  const pendingPromptRef = useRef(data.inlinePrompt || '');
  const pendingResumeRef = useRef(shouldResumeOnMount);
  const needsAutoMintRef = useRef(shouldResumeOnMount);
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  // Double-Escape is the only keyboard way out of a focused terminal; the
  // arbiter owns that window and the blur sequence.
  const arbitrateTerminalKey = useRef(createTerminalKeyArbiter({
    getTerminal: () => termRef.current,
    getContainer: () => containerRef.current,
  })).current;
  const fitRef = useRef<FitAddon | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const spawnedRef = useRef(false);
  const nodeIdRef = useRef(node.id);
  nodeIdRef.current = node.id;
  const dataRef = useRef(data);
  dataRef.current = data;
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;
  const getAllNodesRef = useRef(getAllNodes);
  getAllNodesRef.current = getAllNodes;

  const handleSessionActivation = useCallback((intent: AgentSessionActivationIntent) => {
    pendingAgentRef.current = intent.agentType;
    pendingCwdRef.current = intent.cwd;
    pendingPromptRef.current = intent.prompt;
    pendingResumeRef.current = intent.resume;
    if (intent.mintSession) needsAutoMintRef.current = true;
    if (intent.nextData) {
      dataRef.current = intent.nextData;
      onUpdateRef.current(nodeIdRef.current, { data: intent.nextData });
    }
    setViewMode('running');
  }, []);
  const { pending: teamAutoResumePending } = useAgentSessionActivation({
    data,
    viewMode,
    disabled: readOnly || isMirrorTerminal,
    teamManaged: isTeamManagedAgent,
    workspaceId,
    rootFolder,
    api: window.canvasWorkspace?.agentTeams,
    onActivate: handleSessionActivation,
  });
  const handleCodexSessionRecovered = useCallback((codexSessionId: string) => {
    const nextData = {
      ...dataRef.current,
      codexSessionId,
      codexSessionMarker: undefined,
    };
    dataRef.current = nextData;
    onUpdateRef.current(nodeIdRef.current, { data: nextData });
  }, []);
  useCodexSessionRecovery({
    data,
    disabled: readOnly || isMirrorTerminal,
    rootFolder,
    api: window.canvasWorkspace?.codexSessions,
    onRecovered: handleCodexSessionRecovered,
  });

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

  // Team agent output markers and exit events are parsed in the MAIN process
  // (agent-teams/pty-bridge observes the PTY directly), so the renderer no
  // longer reports them — parsing keeps working with the window closed.
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
        const mirror = mountMirrorTerminal({
          container: containerRef.current,
          workspaceId,
          nodeId: nodeIdRef.current,
          sessionId: activeSessionId,
          readOnly,
          getSavedScrollback: () => dataRef.current.scrollback,
          onKeyEvent: (event) => {
            if (handleTerminalShortcut(event, {
              'terminal.mentionPicker': () => setPickerOpen(true),
            })) return false;
            return arbitrateTerminalKey(event);
          },
          pty: window.canvasWorkspace?.pty,
        });
        termRef.current = mirror.term;
        fitRef.current = mirror.fitAddon;
        cleanupRef.current = mirror.dispose;
        return;
      }

      if (readOnly) {
        spawnedRef.current = true;
        const mount = mountReadonlyTerminal({
          container: containerRef.current,
          scrollback: dataRef.current.scrollback,
        });
        termRef.current = mount.term;
        fitRef.current = mount.fitAddon;
        cleanupRef.current = mount.dispose;
        return;
      }
      spawnedRef.current = true;
      const mount = mountOwnerTerminal({
        container: containerRef.current,
        request: {
          nodeId: nodeIdRef.current,
          sessionId,
          agentType,
          cwd,
          inlinePromptOverride,
          resume: resumeMode,
          rootFolder,
          workspaceId,
        },
        state: {
          get: () => dataRef.current,
          update: (mutate, options) => {
            const nextData = mutate(dataRef.current);
            dataRef.current = nextData;
            if (options) onUpdateRef.current(nodeIdRef.current, { data: nextData }, options);
            else onUpdateRef.current(nodeIdRef.current, { data: nextData });
            return nextData;
          },
        },
        adapters: {
          pty: window.canvasWorkspace?.pty,
          codexSessions: window.canvasWorkspace?.codexSessions,
        },
        events: {
          onLoadingChange: setLoading,
          onExit: () => {
            if (dataRef.current.agentTeamId) setViewMode('restart');
          },
          onKeyEvent: (event) => {
            if (handleTerminalShortcut(event, {
              'terminal.mentionPicker': () => setPickerOpen(true),
            })) return false;
            return arbitrateTerminalKey(event);
          },
        },
      });
      termRef.current = mount.term;
      fitRef.current = mount.fitAddon;
      cleanupRef.current = mount.dispose;
    },
    [isMirrorTerminal, rootFolder, workspaceId, readOnly],
  );

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
      const term = termRef.current;
      const cleanup = cleanupRef.current;
      cleanup?.();
      if (!cleanup) term?.dispose();
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
    // Container CSS width/height resolve through `calc(100% * var(--canvas-scale))`
    // so canvas zoom changes also fire this observer. We update the xterm
    // font size to track the zoom (the inverse-scale wrapper keeps xterm
    // in a net `transform: 1` space, so selection math stays correct).
    // Debounced: bursts (canvas fit animation, node drag-resize) settle
    // to a single refit instead of one per frame per terminal.
    const refit = createDebouncedTerminalRefit(() => {
      const term = termRef.current;
      const fit = fitRef.current;
      if (!term || !fit) return;
      syncTerminalFontSizeToCanvas(term, containerRef.current);
      // Never scroll here: a refit can fire while the user reads history.
      fitTerminalIfSane(term, fit);
    });
    const observer = new ResizeObserver(refit.schedule);
    if (containerRef.current) observer.observe(containerRef.current);
    return () => {
      observer.disconnect();
      refit.cancel();
    };
  }, [viewMode]);

  useEffect(() => {
    if (readOnly || isMirrorTerminal) return;
    if (dataRef.current.viewMode === viewMode) return;
    onUpdateRef.current(nodeIdRef.current, {
      data: { ...dataRef.current, viewMode },
    });
  }, [viewMode, isMirrorTerminal, readOnly]);

  const ensureAgentCommandAvailable = useCallback(async (agentType: string, skipPreflight = false): Promise<boolean> => {
    setLaunchErrorCommand(null);
    if (skipPreflight) return true;
    const command = getAgentCommand(agentType);
    if (!command) return true;
    const api = window.canvasWorkspace?.pty;
    if (!api?.checkCommand) return true;
    const commands = workspaceId && command !== 'pulse-canvas' ? [command, 'pulse-canvas'] : [command];
    for (const requiredCommand of commands) {
      const result = await api.checkCommand(requiredCommand);
      if (result.ok && result.available) continue;
      setLaunchErrorCommand(requiredCommand);
      return false;
    }
    return true;
  }, [workspaceId]);

  const handleLaunch = useCallback(async (options?: { skipPreflight?: boolean }) => {
    if (readOnly || isMirrorTerminal) return;
    if (!(await ensureAgentCommandAvailable(selectedAgent, options?.skipPreflight))) return;
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
    const freshCliSessionId = selectedAgent === 'claude-code' ? crypto.randomUUID() : undefined;
    const nextData = {
      ...dataRef.current,
      agentType: selectedAgent,
      cwd: effectiveCwd,
      inlinePrompt: prompt,
      lastInitPrompt: prompt || dataRef.current.lastInitPrompt || '',
      dangerousMode: effectiveDangerousMode,
      status: 'running' as const,
      sessionId: freshSessionId,
      scrollback: '',
      cliSessionId: freshCliSessionId,
      codexSessionId: undefined,
      codexSessionMarker: undefined,
    };
    dataRef.current = nextData;
    onUpdateRef.current(nodeIdRef.current, {
      data: nextData,
    });
    setFromRestart(false);
    setViewMode('running');
  }, [selectedAgent, cwdInput, promptInput, dangerousMode, rootFolder, isMirrorTerminal, readOnly, ensureAgentCommandAvailable]);

  const handleMentionSelect = useCallback((selected: CanvasNode) => {
    if (readOnly) return;
    setPickerOpen(false);
    const api = window.canvasWorkspace?.pty;
    if (api) {
      const activeSessionId = dataRef.current.sessionId || nodeIdRef.current;
      void api.write(activeSessionId, buildNodeMentionInsertion(selected));
    }
    termRef.current?.focus();
  }, [readOnly]);

  const handleMentionClose = useCallback(() => {
    setPickerOpen(false);
    termRef.current?.focus();
  }, []);

  const handleRestartSession = useCallback(async (options?: { skipPreflight?: boolean }) => {
    if (readOnly || isMirrorTerminal) return;
    const savedAgent = data.agentType || selectedAgent;
    if (!(await ensureAgentCommandAvailable(savedAgent, options?.skipPreflight))) return;
    const savedCwd = data.cwd || rootFolder || '';
    const savedPrompt = data.lastInitPrompt || '';
    const shouldResumeSavedSession =
      savedAgent === dataRef.current.agentType
      && getCodingAgentResumeBinding(dataRef.current).canResume;
    pendingAgentRef.current = savedAgent;
    pendingCwdRef.current = savedCwd;
    pendingPromptRef.current = shouldResumeSavedSession ? '' : savedPrompt;
    pendingResumeRef.current = shouldResumeSavedSession;
    const api = window.canvasWorkspace?.pty;
    const oldSessionId = dataRef.current.sessionId;
    if (api && oldSessionId) api.kill(oldSessionId);
    const freshSessionId = mintSessionId(nodeIdRef.current);
    const nextData = {
      ...dataRef.current,
      agentType: savedAgent,
      cwd: savedCwd,
      inlinePrompt: shouldResumeSavedSession ? '' : savedPrompt,
      status: 'running' as const,
      sessionId: freshSessionId,
      scrollback: '',
      codexSessionId: savedAgent === 'codex' && shouldResumeSavedSession
        ? dataRef.current.codexSessionId
        : undefined,
      codexSessionMarker: undefined,
    };
    dataRef.current = nextData;
    onUpdateRef.current(nodeIdRef.current, {
      data: nextData,
    });
    setFromRestart(false);
    setViewMode('running');
  }, [data.agentType, data.cwd, data.lastInitPrompt, selectedAgent, rootFolder, isMirrorTerminal, readOnly, ensureAgentCommandAvailable]);

  const handleSelectedAgentChange = useCallback((agentType: string) => {
    setLaunchErrorCommand(null);
    setSelectedAgent(agentType);
  }, []);

  const handleEditInit = useCallback(() => {
    if (readOnly || isMirrorTerminal) return;
    setSelectedAgent(normalizeAgentType(data.agentType || selectedAgent));
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
    launchErrorCommand,
    loading,
    pickerOpen,
    promptInput,
    recentCwds,
    selectedAgent,
    setCwdInput,
    setPromptInput,
    setSelectedAgent: handleSelectedAgentChange,
    dangerousMode,
    setDangerousMode,
    status: data.status ?? 'idle',
    teamAutoResumePending,
    viewMode,
    visibleNodes: getAllNodesRef.current?.() ?? [],
  };
};
