import { useCallback, useEffect, useRef, useState } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import type { AgentNodeData, CanvasNode } from '../../../../types';
import { getAgentCommand } from '../../../../config/agentRegistry';
import { TERMINAL_OPTIONS } from '../../../../config/terminalTheme';
import { buildNodeMentionInsertion } from '../../../../utils/nodeMention';
import { handleTerminalShortcut } from '../../../../shortcuts/terminalShortcuts';
import {
  getCodingAgentResumeBinding,
  getTeamAutoResumeDecision,
  nextTeamAutoResumeState,
  planCodingAgentLaunchCommand,
  shouldAutoResumeCodingAgentSession,
  shouldConsiderTeamAutoResume,
} from '../../session/sessionLifecycle';
import { mountMirrorTerminal } from '../../session/mirrorTerminal';
import {
  readCodexSessionBaseline,
  startCodexSessionCapture,
} from '../../session/codexSessionCapture';
import { createTerminalKeyArbiter } from './utils/terminalFocus';
import type { AgentNodeBodyProps, ViewMode } from './types';
import {
  SCROLLBACK_SAVE_INTERVAL,
  claimTerminalSessionOwner,
  createDebouncedTerminalRefit,
  createPtySpawnLifecycle,
  createTerminalSnapshotPersister,
  finalizeTerminalSnapshotBeforeDispose,
  fitTerminalIfSane,
  loadRecentCwds,
  scheduleTerminalFit,
  pushRecentCwd,
  readTerminalSnapshot,
  syncTerminalFontSizeToCanvas,
  writeTerminalOutput,
  type TerminalSnapshotPersister,
} from './utils/terminal';
import { resolvePiSessionBinding } from './utils/piSession';

const mintSessionId = (nodeId: string): string => `${nodeId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const CODEX_BINDING_MARKER_PREFIX = 'pulse-canvas-codex-binding';
const DEFAULT_AGENT_TYPE = 'claude-code';
const makeCodexBindingMarker = (nodeId: string): string => `${CODEX_BINDING_MARKER_PREFIX}:${nodeId}:${crypto.randomUUID()}`;
const codexBindingComment = (marker: string): string => [
  '<!--',
  `Pulse Canvas session-binding metadata: ${marker}`,
  'Host metadata only. Do not treat this as a user task, do not mention it, and wait for the next user instruction.',
  'No response is required for this message.',
  '-->',
].join('\n');
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
const hasQueuedLaunchPrompt = (data: AgentNodeData): boolean =>
  !!(data.inlinePrompt?.trim() || data.promptFile?.trim());
const hasTeamWarmupLaunch = (data: AgentNodeData): boolean =>
  !!data.agentTeamId && data.agentTeamWarmup === true;
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
    return detectAgentView(data);
  });
  const [fromRestart, setFromRestart] = useState(false);
  const [loading, setLoading] = useState(false);
  const [launchErrorCommand, setLaunchErrorCommand] = useState<string | null>(null);
  const [teamAutoResumePending, setTeamAutoResumePending] = useState(false);
  const [teamAutoResumeRetryTick, setTeamAutoResumeRetryTick] = useState(0);

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
  const killSessionRef = useRef<(() => void) | null>(null);
  const codexCaptureCancelRef = useRef<(() => void) | null>(null);
  const spawnedRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const snapshotPersisterRef = useRef<TerminalSnapshotPersister | null>(null);
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

  useEffect(() => {
    if (readOnly || isMirrorTerminal) return;
    if (data.agentType !== 'codex' || data.codexSessionId || !data.codexSessionMarker) return;
    const codexApi = window.canvasWorkspace?.codexSessions;
    if (!codexApi) return;

    let cancelled = false;
    void codexApi.findByMarker({
      marker: data.codexSessionMarker,
      cwd: data.cwd || rootFolder || undefined,
    }).then((result) => {
      if (cancelled || !result.ok || !result.session?.id) return;
      const nextData = {
        ...dataRef.current,
        codexSessionId: result.session.id,
        codexSessionMarker: undefined,
      };
      dataRef.current = nextData;
      onUpdateRef.current(nodeIdRef.current, {
        data: nextData,
      });
    });

    return () => {
      cancelled = true;
    };
  }, [
    data.agentType,
    data.codexSessionId,
    data.codexSessionMarker,
    data.cwd,
    isMirrorTerminal,
    readOnly,
    rootFolder,
  ]);

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
        scheduleTerminalFit(fitAddon, term, containerRef.current);
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
        if (handleTerminalShortcut(e, {
          'terminal.mentionPicker': () => setPickerOpen(true),
        })) return false;
        return arbitrateTerminalKey(e);
      });

      scheduleTerminalFit(fitAddon, term, containerRef.current);

      const api = window.canvasWorkspace?.pty;
      if (!api) {
        term.writeln('\x1b[31mError: pty API not available (preload missing)\x1b[0m');
        return;
      }
      const sessionOwner = claimTerminalSessionOwner(sessionId);
      const spawnLifecycle = createPtySpawnLifecycle(sessionOwner);
      cleanupRef.current = spawnLifecycle.cancel;
      killSessionRef.current = sessionOwner.finishFinalization;
      const snapshotPersister = createTerminalSnapshotPersister({
        initialSnapshot: { scrollback: dataRef.current.scrollback ?? '', cwd: dataRef.current.cwd ?? '' },
        readSnapshot: () => readTerminalSnapshot(term, () => api.getCwd(sessionId), dataRef.current.cwd ?? ''),
        persist: (snapshot) => sessionOwner.persistIfCurrent(snapshot, ({ scrollback, cwd: persistedCwd }) => onUpdateRef.current(nodeIdRef.current, {
          data: { ...dataRef.current, scrollback, cwd: persistedCwd },
        }, { history: false })),
      });
      snapshotPersisterRef.current = snapshotPersister;

      const spawnCwd = cwd || rootFolder || undefined;
      const command = getAgentCommand(agentType);
      const existingCliSessionId = agentType === 'claude-code'
        ? dataRef.current.cliSessionId
        : undefined;
      const cliSessionId = existingCliSessionId || crypto.randomUUID();
      const canResumeClaude = !!existingCliSessionId;
      if (agentType === 'claude-code' && dataRef.current.cliSessionId !== cliSessionId) {
        const nextData = {
          ...dataRef.current,
          cliSessionId,
        };
        dataRef.current = nextData;
        onUpdateRef.current(nodeIdRef.current, { data: nextData });
      }
      const piSession = resolvePiSessionBinding(agentType, dataRef.current.piSessionKey);
      if (piSession.key && dataRef.current.piSessionKey !== piSession.key) {
        const nextData = { ...dataRef.current, piSessionKey: piSession.key };
        dataRef.current = nextData;
        onUpdateRef.current(nodeIdRef.current, { data: nextData });
      }
      const writeCommandTimeRef = { current: 0 };

      const writeCommand = async () => {
        if (spawnLifecycle.isCancelled()) return;
        if (!command) {
          writeTerminalOutput(term, `\x1b[33mUnknown agent type: ${agentType}\x1b[0m`, snapshotPersister, true);
          setLoading(false);
          return;
        }
        const shouldCaptureNewCodexSession = agentType === 'codex' && !resumeMode;
        const codexBaselineIds = shouldCaptureNewCodexSession
          ? await readCodexSessionBaseline(window.canvasWorkspace?.codexSessions)
          : null;
        if (spawnLifecycle.isCancelled()) return;
        writeCommandTimeRef.current = Date.now();

        const { inlinePrompt, promptFile, agentArgs, dangerousMode } = dataRef.current;
        const effectivePrompt = inlinePromptOverride || inlinePrompt;
        const codexBindingMarker = shouldCaptureNewCodexSession
          ? dataRef.current.codexSessionMarker || makeCodexBindingMarker(nodeIdRef.current)
          : undefined;
        const codexBindingPrompt = codexBindingMarker ? codexBindingComment(codexBindingMarker) : '';
        const commandPlan = planCodingAgentLaunchCommand({
          agentType,
          command,
          resume: resumeMode && (agentType !== 'claude-code' || canResumeClaude),
          cliSessionId,
          codexSessionId: dataRef.current.codexSessionId,
          piFlags: piSession.flags(resumeMode),
          prompt: effectivePrompt,
          promptFile,
          codexBindingPrompt,
          dangerousMode,
          agentArgs,
          teamManaged: !!dataRef.current.agentTeamId,
        });
        if ('error' in commandPlan) {
          const message = commandPlan.error === 'missing-codex-session'
            ? 'Cannot resume Codex: saved session id is missing.'
            : `Unknown agent type: ${agentType}`;
          writeTerminalOutput(term, `\x1b[33m${message}\x1b[0m`, snapshotPersister, true);
          setLoading(false);
          return;
        }
        api.write(sessionId, commandPlan.commandLine);

        if (shouldCaptureNewCodexSession) {
          const codexApi = window.canvasWorkspace?.codexSessions;
          if (codexApi) {
            codexCaptureCancelRef.current?.();
            codexCaptureCancelRef.current = startCodexSessionCapture({
              api: codexApi,
              baselineIds: codexBaselineIds,
              launchStartedAt: writeCommandTimeRef.current,
              marker: codexBindingMarker,
              cwd: spawnCwd,
              onCaptured: (codexSessionId) => {
                if (
                  dataRef.current.agentType !== 'codex'
                  || dataRef.current.sessionId !== sessionId
                ) return;
                const nextData = {
                  ...dataRef.current,
                  codexSessionId,
                  codexSessionMarker: undefined,
                };
                dataRef.current = nextData;
                onUpdateRef.current(nodeIdRef.current, { data: nextData });
              },
            });
          }
        }

        if (effectivePrompt || promptFile || codexBindingMarker) {
          const nextData = {
            ...dataRef.current,
            inlinePrompt: '',
            promptFile: '',
            lastInitPrompt: effectivePrompt || dataRef.current.lastInitPrompt || '',
            codexSessionMarker: codexBindingMarker ?? dataRef.current.codexSessionMarker,
          };
          dataRef.current = nextData;
          onUpdateRef.current(nodeIdRef.current, {
            data: nextData,
          });
        }
      };

      let prompted = false;
      let promptFallbackTimer: ReturnType<typeof setTimeout> | null = null;
      let commandStartTimer: ReturnType<typeof setTimeout> | null = null;
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
      const markTeamWarmupReady = () => {
        if (!hasTeamWarmupLaunch(dataRef.current) || dataRef.current.agentTeamWarmupReady) return;
        const nextData = {
          ...dataRef.current,
          agentTeamWarmupReady: true,
        };
        dataRef.current = nextData;
        onUpdateRef.current(nodeIdRef.current, { data: nextData });
      };
      const scheduleQuiescence = () => {
        if (loadingDismissed) return;
        if (quiescenceTimer) clearTimeout(quiescenceTimer);
        quiescenceTimer = setTimeout(() => {
          quiescenceTimer = null;
          markTeamWarmupReady();
          dismissLoading();
        }, QUIESCENCE_MS);
      };
      const loadingTimeout = setTimeout(dismissLoading, FAILSAFE_MS);

      const attachPermanentListener = () => {
        removeDataRef.current = api.onData(sessionId, (d: string) => {
          writeTerminalOutput(term, d, snapshotPersister);
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

      const promptRemoveRef: { current: (() => void) | null } = { current: null };
      const startInitialCommand = () => {
        if (prompted || spawnLifecycle.isCancelled()) return;
        prompted = true;
        if (promptFallbackTimer) {
          clearTimeout(promptFallbackTimer);
          promptFallbackTimer = null;
        }
        promptRemoveRef.current?.();
        promptRemoveRef.current = null;
        attachPermanentListener();
        commandStartTimer = setTimeout(() => {
          commandStartTimer = null;
          void writeCommand();
        }, 100);
      };

      promptRemoveRef.current = api.onData(sessionId, (d: string) => {
        writeTerminalOutput(term, d, snapshotPersister);
        startInitialCommand();
      });

      const removeExit = api.onExit(sessionId, (code: number) => {
        writeTerminalOutput(term, `\r\n\x1b[2m[Agent exited with code ${code}]\x1b[0m`, snapshotPersister, true);
        dismissLoading();
        onUpdateRef.current(nodeIdRef.current, {
          data: { ...dataRef.current, status: 'done' },
        });
        // A team-managed agent must stay relaunchable while mounted: every
        // launch effect bails while viewMode is 'running', so keeping it
        // there after the PTY died would strand everything the main process
        // queues afterwards (lead notifications, redispatched tasks) until
        // the node happens to remount. Dropping to the restart view re-arms
        // the queued-launch and team auto-resume effects.
        if (dataRef.current.agentTeamId) {
          setViewMode('restart');
        }
      });

      const cleanupSpawnResources = () => {
        spawnLifecycle.cancel(() => {
          if (!prompted) promptRemoveRef.current?.();
          if (promptFallbackTimer) clearTimeout(promptFallbackTimer);
          if (commandStartTimer) clearTimeout(commandStartTimer);
          removeDataRef.current?.();
          removeExit();
          codexCaptureCancelRef.current?.();
          codexCaptureCancelRef.current = null;
          clearTimeout(loadingTimeout);
          dismissLoading();
        });
      };
      cleanupRef.current = cleanupSpawnResources;

      const currentData = dataRef.current;
      const result = await api.spawn(sessionId, term.cols, term.rows, spawnCwd, workspaceId, {
        PULSE_CANVAS_WORKSPACE_ID: workspaceId,
        PULSE_CANVAS_NODE_ID: nodeIdRef.current,
        PULSE_CANVAS_TEAM_ID: currentData.agentTeamId,
        PULSE_CANVAS_TEAM_AGENT_ID: currentData.agentTeamAgentId,
        PULSE_CANVAS_TEAM_ROLE: currentData.agentTeamRole,
      });
      if (spawnLifecycle.reclaimIfCancelled(result, (leaseId) => api.kill(sessionId, leaseId))) return;
      if (!result.ok) {
        cleanupSpawnResources();
        sessionOwner.finishFinalization();
        writeTerminalOutput(term, `\x1b[31mFailed to spawn shell: ${result.error}\x1b[0m`, snapshotPersister, true);
        onUpdateRef.current(nodeIdRef.current, {
          data: { ...dataRef.current, status: 'error' },
        });
        return;
      }
      killSessionRef.current = () => { try { api.kill(sessionId, result.leaseId); } finally { sessionOwner.finishFinalization(); } };
      promptFallbackTimer = setTimeout(startInitialCommand, 500);

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
          cliSessionId: agentType === 'claude-code' ? cliSessionId : undefined,
          codexSessionId: agentType === 'codex' && resumeMode
            ? dataRef.current.codexSessionId
            : undefined,
        },
      });

      saveTimerRef.current = setInterval(() => void snapshotPersister.flush().catch(() => undefined), SCROLLBACK_SAVE_INTERVAL);
    },
    [isMirrorTerminal, rootFolder, workspaceId, readOnly],
  );

  useEffect(() => {
    if (readOnly || isMirrorTerminal) return;
    if (viewMode === 'running') return;
    if (data.viewMode !== 'running' && data.status !== 'running') return;

    const hasLaunchPrompt = hasQueuedLaunchPrompt(data);
    const shouldResumeSavedConversation = !isTeamManagedAgent && !hasLaunchPrompt
      && getCodingAgentResumeBinding(data).canResume;
    if (!hasLaunchPrompt && !hasTeamWarmupLaunch(data) && !shouldResumeSavedConversation) return;

    pendingAgentRef.current = normalizeAgentType(data.agentType);
    pendingCwdRef.current = data.cwd || rootFolder || '';
    pendingPromptRef.current = data.inlinePrompt || '';
    pendingResumeRef.current = shouldResumeSavedConversation;
    if (hasTeamWarmupLaunch(data)) needsAutoMintRef.current = true;
    setViewMode('running');
  }, [
    data.agentType,
    data.cliSessionId,
    data.codexSessionId,
    data.piSessionKey,
    data.cwd,
    data.agentTeamWarmup,
    data.inlinePrompt,
    data.promptFile,
    data.status,
    data.viewMode,
    isMirrorTerminal,
    isTeamManagedAgent,
    forceTeamWarmup,
    readOnly,
    rootFolder,
    viewMode,
  ]);

  useEffect(() => {
    if (readOnly || isMirrorTerminal || !isTeamManagedAgent) return;
    if (viewMode === 'running') return;
    if (!workspaceId || !data.agentTeamId || !data.agentTeamAgentId) return;
    if (!shouldConsiderTeamAutoResume(data)) return;

    const autoResumeDecision = getTeamAutoResumeDecision(data);
    if (!autoResumeDecision.eligible) {
      const retryDelay = autoResumeDecision.retryAfterMs;
      if (retryDelay != null) {
        setTeamAutoResumePending(true);
        const timer = setTimeout(() => {
          setTeamAutoResumeRetryTick((tick) => tick + 1);
        }, retryDelay);
        return () => clearTimeout(timer);
      }
      return;
    }

    let cancelled = false;
    setTeamAutoResumePending(true);
    void (async () => {
      const result = await window.canvasWorkspace?.agentTeams?.prepareAgentAutoResume(
        workspaceId,
        data.agentTeamId!,
        data.agentTeamAgentId!,
      ).catch(() => null);
      if (cancelled) return;
      if (!result?.ok || !result.canResume) {
        setTeamAutoResumePending(false);
        return;
      }

      pendingAgentRef.current = normalizeAgentType(data.agentType);
      pendingCwdRef.current = data.cwd || rootFolder || '';
      pendingPromptRef.current = '';
      pendingResumeRef.current = true;
      needsAutoMintRef.current = true;
      const nextData = {
        ...dataRef.current,
        status: 'running' as const,
        inlinePrompt: '',
        promptFile: '',
        agentTeamAutoResume: nextTeamAutoResumeState(dataRef.current),
      };
      dataRef.current = nextData;
      onUpdateRef.current(nodeIdRef.current, {
        data: nextData,
      });
      setTeamAutoResumePending(false);
      setViewMode('running');
    })();

    return () => {
      cancelled = true;
      setTeamAutoResumePending(false);
    };
  }, [
    data.agentTeamAgentId,
    data.agentTeamId,
    data.agentTeamWarmup,
    data.agentType,
    data.cliSessionId,
    data.codexSessionId,
    data.piSessionKey,
    data.cwd,
    data.agentTeamAutoResume,
    data.inlinePrompt,
    data.promptFile,
    data.scrollback,
    data.sessionId,
    data.status,
    data.viewMode,
    isMirrorTerminal,
    isTeamManagedAgent,
    forceTeamWarmup,
    readOnly,
    rootFolder,
    teamAutoResumeRetryTick,
    viewMode,
    workspaceId,
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
        codexCaptureCancelRef.current?.();
        codexCaptureCancelRef.current = null;
        termRef.current = null;
        fitRef.current = null;
        spawnedRef.current = false;
        cleanupRef.current = null;
        setLoading(false);
        return;
      }
      if (saveTimerRef.current) clearInterval(saveTimerRef.current);
      const persister = snapshotPersisterRef.current;
      const term = termRef.current;
      const killSession = killSessionRef.current;
      cleanupRef.current?.();
      codexCaptureCancelRef.current?.();
      codexCaptureCancelRef.current = null;
      if (viewMode === 'running' && persister && term) {
        finalizeTerminalSnapshotBeforeDispose(term, persister, () => { killSession?.(); term.dispose(); });
      } else {
        killSession?.();
        term?.dispose();
      }
      containerRef.current?.replaceChildren();
      termRef.current = null;
      fitRef.current = null;
      spawnedRef.current = false;
      cleanupRef.current = null;
      snapshotPersisterRef.current = null;
      killSessionRef.current = null;
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
