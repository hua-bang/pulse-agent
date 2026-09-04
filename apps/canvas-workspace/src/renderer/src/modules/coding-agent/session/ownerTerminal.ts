import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { getAgentCommand } from '../../../config/agentRegistry';
import { TERMINAL_OPTIONS } from '../../../config/terminalTheme';
import type { AgentNodeData, CanvasWorkspaceApi, CodexSessionsApi } from '../../../types';
import {
  SCROLLBACK_SAVE_INTERVAL,
  claimTerminalSessionOwner,
  createPtySpawnLifecycle,
  createTerminalSnapshotPersister,
  finalizeTerminalSnapshotBeforeDispose,
  readTerminalSnapshot,
  scheduleTerminalFit,
  writeTerminalOutput,
} from '../components/AgentNodeBody/utils/terminal';
import { resolvePiSessionBinding } from './piSession';
import { readCodexSessionBaseline, startCodexSessionCapture } from './codexSessionCapture';
import { planCodingAgentLaunchCommand } from './sessionLifecycle';

const CODEX_BINDING_MARKER_PREFIX = 'pulse-canvas-codex-binding';
const makeCodexBindingMarker = (nodeId: string): string =>
  `${CODEX_BINDING_MARKER_PREFIX}:${nodeId}:${crypto.randomUUID()}`;
const codexBindingComment = (marker: string): string => [
  '<!--',
  `Pulse Canvas session-binding metadata: ${marker}`,
  'Host metadata only. Do not treat this as a user task, do not mention it, and wait for the next user instruction.',
  'No response is required for this message.',
  '-->',
].join('\n');

export interface OwnerTerminalRequest {
  nodeId: string;
  sessionId: string;
  agentType: string;
  cwd: string;
  inlinePromptOverride?: string;
  resume: boolean;
  rootFolder?: string;
  workspaceId?: string;
}

export interface OwnerTerminalState {
  get: () => AgentNodeData;
  update: (
    mutate: (current: AgentNodeData) => AgentNodeData,
    options?: { history?: boolean },
  ) => AgentNodeData;
}

interface OwnerTerminalAdapters {
  pty: CanvasWorkspaceApi['pty'] | undefined;
  codexSessions?: CodexSessionsApi;
}

interface OwnerTerminalEvents {
  onLoadingChange: (loading: boolean) => void;
  onExit: () => void;
  onKeyEvent: (event: KeyboardEvent) => boolean;
}

export interface OwnerTerminalMount {
  term: Terminal;
  fitAddon: FitAddon;
  dispose: () => void;
}

interface MountOwnerTerminalOptions {
  container: HTMLElement;
  request: OwnerTerminalRequest;
  state: OwnerTerminalState;
  adapters: OwnerTerminalAdapters;
  events: OwnerTerminalEvents;
}

export const mountReadonlyTerminal = ({
  container,
  scrollback,
}: {
  container: HTMLElement;
  scrollback?: string;
}): OwnerTerminalMount => {
  const term = new Terminal(TERMINAL_OPTIONS);
  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  container.replaceChildren();
  term.open(container);
  if (scrollback) {
    term.writeln('\x1b[2m--- restored agent output ---\x1b[0m');
    term.write(scrollback.split('\n').join('\r\n'));
    term.writeln('');
  } else {
    term.writeln('\x1b[2m--- no saved agent output ---\x1b[0m');
  }
  scheduleTerminalFit(fitAddon, term, container);
  return { term, fitAddon, dispose: () => term.dispose() };
};

export const mountOwnerTerminal = ({
  container,
  request,
  state,
  adapters,
  events,
}: MountOwnerTerminalOptions): OwnerTerminalMount => {
  const term = new Terminal(TERMINAL_OPTIONS);
  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  container.replaceChildren();
  term.open(container);
  term.attachCustomKeyEventHandler(events.onKeyEvent);
  scheduleTerminalFit(fitAddon, term, container);
  events.onLoadingChange(true);

  const api = adapters.pty;
  if (!api) {
    term.writeln('\x1b[31mError: pty API not available (preload missing)\x1b[0m');
    events.onLoadingChange(false);
    return { term, fitAddon, dispose: () => term.dispose() };
  }

  const sessionOwner = claimTerminalSessionOwner(request.sessionId);
  const spawnLifecycle = createPtySpawnLifecycle(sessionOwner);
  const existingCliSessionId = request.agentType === 'claude-code'
    ? state.get().cliSessionId
    : undefined;
  const cliSessionId = existingCliSessionId || crypto.randomUUID();
  const canResumeClaude = !!existingCliSessionId;
  if (request.agentType === 'claude-code' && state.get().cliSessionId !== cliSessionId) {
    state.update((value) => ({ ...value, cliSessionId }));
  }
  const piSession = resolvePiSessionBinding(request.agentType, state.get().piSessionKey);
  if (piSession.key && state.get().piSessionKey !== piSession.key) {
    state.update((value) => ({ ...value, piSessionKey: piSession.key }));
  }
  let killSession = sessionOwner.finishFinalization;
  let codexCaptureCancel: (() => void) | null = null;
  let saveTimer: ReturnType<typeof setInterval> | null = null;
  let disposed = false;
  let prompted = false;
  let promptFallbackTimer: ReturnType<typeof setTimeout> | null = null;
  let commandStartTimer: ReturnType<typeof setTimeout> | null = null;
  let quiescenceTimer: ReturnType<typeof setTimeout> | null = null;
  let loadingDismissed = false;
  let bannerStarted = false;
  let writeCommandTime = 0;
  let removePromptData: (() => void) | null = null;
  let removeData: (() => void) | null = null;
  let removeExit: (() => void) | null = null;
  const ECHO_WINDOW_MS = 300;
  const QUIESCENCE_MS = 500;
  const FAILSAFE_MS = 15_000;

  const snapshotPersister = createTerminalSnapshotPersister({
    initialSnapshot: {
      scrollback: state.get().scrollback ?? '',
      cwd: state.get().cwd ?? '',
    },
    readSnapshot: () => readTerminalSnapshot(
      term,
      () => api.getCwd(request.sessionId),
      state.get().cwd ?? '',
    ),
    persist: (snapshot) => sessionOwner.persistIfCurrent(snapshot, ({ scrollback, cwd }) => {
      state.update((current) => ({ ...current, scrollback, cwd }), { history: false });
    }),
  });

  const dismissLoading = () => {
    if (loadingDismissed) return;
    loadingDismissed = true;
    if (quiescenceTimer) clearTimeout(quiescenceTimer);
    quiescenceTimer = null;
    events.onLoadingChange(false);
  };
  const markTeamWarmupReady = () => {
    const current = state.get();
    if (!current.agentTeamId || !current.agentTeamWarmup || current.agentTeamWarmupReady) return;
    state.update((value) => ({ ...value, agentTeamWarmupReady: true }));
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

  const writeCommand = async () => {
    if (spawnLifecycle.isCancelled()) return;
    const command = getAgentCommand(request.agentType);
    if (!command) {
      writeTerminalOutput(term, `\x1b[33mUnknown agent type: ${request.agentType}\x1b[0m`, snapshotPersister, true);
      dismissLoading();
      return;
    }
    const shouldCaptureCodex = request.agentType === 'codex' && !request.resume;
    const codexBaselineIds = shouldCaptureCodex
      ? await readCodexSessionBaseline(adapters.codexSessions)
      : null;
    if (spawnLifecycle.isCancelled()) return;
    writeCommandTime = Date.now();

    const launchData = state.get();
    const effectivePrompt = request.inlinePromptOverride || launchData.inlinePrompt;
    const codexBindingMarker = shouldCaptureCodex
      ? launchData.codexSessionMarker || makeCodexBindingMarker(request.nodeId)
      : undefined;
    const commandPlan = planCodingAgentLaunchCommand({
      agentType: request.agentType,
      command,
      resume: request.resume && (request.agentType !== 'claude-code' || canResumeClaude),
      cliSessionId,
      codexSessionId: launchData.codexSessionId,
      piFlags: piSession.flags(request.resume),
      prompt: effectivePrompt,
      promptFile: launchData.promptFile,
      codexBindingPrompt: codexBindingMarker ? codexBindingComment(codexBindingMarker) : '',
      dangerousMode: launchData.dangerousMode,
      agentArgs: launchData.agentArgs,
      teamManaged: !!launchData.agentTeamId,
    });
    if ('error' in commandPlan) {
      const message = commandPlan.error === 'missing-codex-session'
        ? 'Cannot resume Codex: saved session id is missing.'
        : `Unknown agent type: ${request.agentType}`;
      writeTerminalOutput(term, `\x1b[33m${message}\x1b[0m`, snapshotPersister, true);
      dismissLoading();
      return;
    }
    api.write(request.sessionId, commandPlan.commandLine);

    if (shouldCaptureCodex && adapters.codexSessions) {
      codexCaptureCancel?.();
      codexCaptureCancel = startCodexSessionCapture({
        api: adapters.codexSessions,
        baselineIds: codexBaselineIds,
        launchStartedAt: writeCommandTime,
        marker: codexBindingMarker,
        cwd: request.cwd || request.rootFolder || undefined,
        onCaptured: (codexSessionId) => {
          const latest = state.get();
          if (latest.agentType !== 'codex' || latest.sessionId !== request.sessionId) return;
          state.update((value) => ({ ...value, codexSessionId, codexSessionMarker: undefined }));
        },
      });
    }

    if (effectivePrompt || launchData.promptFile || codexBindingMarker) {
      state.update((value) => ({
        ...value,
        inlinePrompt: '',
        promptFile: '',
        lastInitPrompt: effectivePrompt || value.lastInitPrompt || '',
        codexSessionMarker: codexBindingMarker ?? value.codexSessionMarker,
      }));
    }
  };

  const attachPermanentListener = () => {
    removeData = api.onData(request.sessionId, (data) => {
      writeTerminalOutput(term, data, snapshotPersister);
      if (loadingDismissed || writeCommandTime === 0) return;
      const since = Date.now() - writeCommandTime;
      if (!bannerStarted) {
        if (since <= ECHO_WINDOW_MS) return;
        bannerStarted = true;
      }
      scheduleQuiescence();
    });
  };
  const startInitialCommand = () => {
    if (prompted || spawnLifecycle.isCancelled()) return;
    prompted = true;
    if (promptFallbackTimer) clearTimeout(promptFallbackTimer);
    promptFallbackTimer = null;
    removePromptData?.();
    removePromptData = null;
    attachPermanentListener();
    commandStartTimer = setTimeout(() => {
      commandStartTimer = null;
      void writeCommand();
    }, 100);
  };

  removePromptData = api.onData(request.sessionId, (data) => {
    writeTerminalOutput(term, data, snapshotPersister);
    startInitialCommand();
  });
  removeExit = api.onExit(request.sessionId, (code) => {
    writeTerminalOutput(term, `\r\n\x1b[2m[Agent exited with code ${code}]\x1b[0m`, snapshotPersister, true);
    dismissLoading();
    state.update((current) => ({ ...current, status: 'done' }));
    events.onExit();
  });

  const cleanupSpawnResources = () => {
    spawnLifecycle.cancel(() => {
      if (!prompted) removePromptData?.();
      if (promptFallbackTimer) clearTimeout(promptFallbackTimer);
      if (commandStartTimer) clearTimeout(commandStartTimer);
      removeData?.();
      removeExit?.();
      codexCaptureCancel?.();
      codexCaptureCancel = null;
      clearTimeout(loadingTimeout);
      dismissLoading();
    });
  };

  const spawnCwd = request.cwd || request.rootFolder || undefined;
  void api.spawn(
    request.sessionId,
    term.cols,
    term.rows,
    spawnCwd,
    request.workspaceId,
    {
      PULSE_CANVAS_WORKSPACE_ID: request.workspaceId,
      PULSE_CANVAS_NODE_ID: request.nodeId,
      PULSE_CANVAS_TEAM_ID: state.get().agentTeamId,
      PULSE_CANVAS_TEAM_AGENT_ID: state.get().agentTeamAgentId,
      PULSE_CANVAS_TEAM_ROLE: state.get().agentTeamRole,
    },
  ).then((result) => {
    if (spawnLifecycle.reclaimIfCancelled(result, (leaseId) => api.kill(request.sessionId, leaseId))) return;
    if (!result.ok) {
      cleanupSpawnResources();
      sessionOwner.finishFinalization();
      writeTerminalOutput(term, `\x1b[31mFailed to spawn shell: ${result.error}\x1b[0m`, snapshotPersister, true);
      state.update((current) => ({ ...current, status: 'error' }));
      return;
    }
    killSession = () => {
      try { api.kill(request.sessionId, result.leaseId); }
      finally { sessionOwner.finishFinalization(); }
    };
    promptFallbackTimer = setTimeout(startInitialCommand, 500);
    term.onData((data) => api.write(request.sessionId, data));
    term.onResize(({ cols, rows }) => api.resize(request.sessionId, cols, rows));
    state.update((current) => ({
      ...current,
      agentType: request.agentType,
      cwd: spawnCwd ?? '',
      status: 'running',
      sessionId: request.sessionId,
      cliSessionId: request.agentType === 'claude-code' ? current.cliSessionId : undefined,
      codexSessionId: request.agentType === 'codex' && request.resume
        ? current.codexSessionId
        : undefined,
    }));
    saveTimer = setInterval(
      () => void snapshotPersister.flush().catch(() => undefined),
      SCROLLBACK_SAVE_INTERVAL,
    );
  });

  return {
    term,
    fitAddon,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      if (saveTimer) clearInterval(saveTimer);
      cleanupSpawnResources();
      finalizeTerminalSnapshotBeforeDispose(term, snapshotPersister, () => {
        killSession();
        term.dispose();
      });
      container.replaceChildren();
    },
  };
};
