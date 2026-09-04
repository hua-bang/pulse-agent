import { useCallback, useEffect, useRef, useState } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { TERMINAL_OPTIONS } from '../../../../../../config/terminalTheme';
import { handleTerminalShortcut } from '../../../../../../shortcuts/terminalShortcuts';
import type { CanvasNode, TerminalNodeData } from '../../../../../../types';
import {
  appendTerminalOutputTail,
  hasLikelyReturnedToShellPrompt,
  isCodingAgentCommand,
} from '../../../../../../utils/codingAgentCommand';
import { buildNodeMentionInsertion } from '../../../../../../utils/nodeMention';
import {
  SCROLLBACK_SAVE_INTERVAL,
  claimTerminalSessionOwner,
  createDebouncedTerminalRefit,
  createPtySpawnLifecycle,
  createTerminalKeyArbiter,
  createTerminalSnapshotPersister,
  finalizeTerminalSnapshotBeforeDispose,
  fitTerminalWithCanvasScale,
  readTerminalSnapshot,
  serializeBuffer,
  syncTerminalFontSizeToCanvas,
  writeTerminalOutput,
} from '../../../../../coding-agent/terminal';

interface Options {
  node: CanvasNode;
  rootFolder?: string;
  workspaceId?: string;
  onUpdate: (
    id: string,
    patch: Partial<CanvasNode>,
    options?: { history?: boolean },
  ) => void;
  readOnly: boolean;
}

export function useTerminalNodeRuntime({
  node,
  rootFolder,
  workspaceId,
  onUpdate,
  readOnly,
}: Options) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [mentionHintVisible, setMentionHintVisible] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const arbitrateTerminalKey = useRef(createTerminalKeyArbiter({
    getTerminal: () => termRef.current,
    getContainer: () => containerRef.current,
  })).current;
  const fitRef = useRef<FitAddon | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const killSessionRef = useRef<(() => void) | null>(null);
  const spawnedRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const snapshotPersisterRef = useRef<ReturnType<typeof createTerminalSnapshotPersister> | null>(null);
  const codingAgentActiveRef = useRef(false);
  const commandInputRef = useRef('');
  const terminalOutputTailRef = useRef('');
  const data = node.data as TerminalNodeData;
  const sessionId = data.sessionId || node.id;
  const nodeIdRef = useRef(node.id);
  nodeIdRef.current = node.id;
  const dataRef = useRef(data);
  dataRef.current = data;
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;
  const workspaceIdRef = useRef(workspaceId);
  workspaceIdRef.current = workspaceId;
  const initialScrollback = useRef(data.scrollback ?? '');
  const initialCwd = useRef(data.cwd ?? '');
  const initialCommand = useRef(data.initialCommand ?? '');

  const dismissMentionHint = useCallback(() => {
    setMentionHintVisible(false);
  }, []);

  const finishCodingAgentHint = useCallback(() => {
    codingAgentActiveRef.current = false;
    terminalOutputTailRef.current = '';
    setMentionHintVisible(false);
  }, []);

  const startCodingAgentHint = useCallback(() => {
    if (readOnly || codingAgentActiveRef.current) return;
    codingAgentActiveRef.current = true;
    terminalOutputTailRef.current = '';
    setMentionHintVisible(true);
  }, [readOnly]);

  const captureTerminalOutput = useCallback((output: string) => {
    if (!codingAgentActiveRef.current) return;
    terminalOutputTailRef.current = appendTerminalOutputTail(
      terminalOutputTailRef.current,
      output,
    );
    if (hasLikelyReturnedToShellPrompt(terminalOutputTailRef.current)) {
      finishCodingAgentHint();
    }
  }, [finishCodingAgentHint]);

  const captureTerminalInput = useCallback((input: string) => {
    for (const character of input) {
      if (character === '\r' || character === '\n') {
        const command = commandInputRef.current;
        commandInputRef.current = '';
        if (isCodingAgentCommand(command)) startCodingAgentHint();
      } else if (character === '\x7f' || character === '\b') {
        commandInputRef.current = commandInputRef.current.slice(0, -1);
      } else if (character === '\x15') {
        commandInputRef.current = '';
      } else if (character >= ' ') {
        commandInputRef.current += character;
      }
    }
  }, [startCodingAgentHint]);

  const initTerminal = useCallback(async () => {
    const container = containerRef.current;
    if (!container || termRef.current || spawnedRef.current) return;
    spawnedRef.current = true;
    const term = new Terminal(TERMINAL_OPTIONS);
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(container);
    termRef.current = term;
    fitRef.current = fitAddon;
    syncTerminalFontSizeToCanvas(term, container);

    if (readOnly) {
      if (initialScrollback.current) {
        term.write(initialScrollback.current.split('\n').join('\r\n'));
      } else {
        term.writeln('\x1b[2m--- no saved terminal output ---\x1b[0m');
      }
      requestAnimationFrame(() => {
        fitTerminalWithCanvasScale(term, fitAddon, containerRef.current);
        try { term.scrollToBottom(); } catch { /* ignore */ }
      });
      return;
    }

    if (initialScrollback.current) {
      const lastLines = initialScrollback.current
        .split('\n')
        .slice(-10)
        .join('\r\n');
      term.writeln('\x1b[2m--- session restored ---\x1b[0m');
      term.write(`${lastLines}\r\n`);
      term.writeln('\x1b[2m--- new session ---\x1b[0m\r\n');
    }

    term.attachCustomKeyEventHandler((event: KeyboardEvent) => {
      if (handleTerminalShortcut(event, {
        'terminal.mentionPicker': () => setPickerOpen(true),
      })) return false;
      return arbitrateTerminalKey(event);
    });

    requestAnimationFrame(() => {
      fitTerminalWithCanvasScale(term, fitAddon, containerRef.current);
      try { term.scrollToBottom(); } catch { /* ignore */ }
    });

    const api = window.canvasWorkspace?.pty;
    const sessionOwner = claimTerminalSessionOwner(sessionId);
    const spawnLifecycle = createPtySpawnLifecycle(sessionOwner);
    cleanupRef.current = spawnLifecycle.cancel;
    killSessionRef.current = sessionOwner.finishFinalization;
    const snapshotPersister = createTerminalSnapshotPersister({
      initialSnapshot: {
        scrollback: dataRef.current.scrollback ?? '',
        cwd: dataRef.current.cwd ?? '',
      },
      readSnapshot: () => api
        ? readTerminalSnapshot(term, () => api.getCwd(sessionId), dataRef.current.cwd ?? '')
        : Promise.resolve({
            scrollback: serializeBuffer(term),
            cwd: dataRef.current.cwd ?? '',
          }),
      persist: (snapshot) => sessionOwner.persistIfCurrent(snapshot, ({ scrollback, cwd }) => {
        onUpdateRef.current(nodeIdRef.current, {
          data: { sessionId: dataRef.current.sessionId, scrollback, cwd },
        }, { history: false });
      }),
    });
    snapshotPersisterRef.current = snapshotPersister;

    if (!api) {
      writeTerminalOutput(
        term,
        '\x1b[31mError: pty API not available (preload missing)\x1b[0m',
        snapshotPersister,
        true,
      );
      return;
    }

    const spawnCwd = initialCwd.current || rootFolder || undefined;
    const result = await api.spawn(
      sessionId,
      term.cols,
      term.rows,
      spawnCwd,
      workspaceIdRef.current,
    );
    if (spawnLifecycle.reclaimIfCancelled(result, (leaseId) => api.kill(sessionId, leaseId))) {
      return;
    }
    if (!result.ok) {
      writeTerminalOutput(
        term,
        `\x1b[31mFailed to spawn shell: ${result.error}\x1b[0m`,
        snapshotPersister,
        true,
      );
      return;
    }

    const removeExit = api.onExit(sessionId, (code: number) => {
      writeTerminalOutput(
        term,
        `\r\n\x1b[2m[Process exited with code ${code}]\x1b[0m`,
        snapshotPersister,
        true,
      );
    });
    let removeData: (() => void) | null = null;
    let removePrompt: (() => void) | null = null;
    const command = initialCommand.current;

    if (command) {
      let prompted = false;
      const promptRemove = api.onData(sessionId, (output: string) => {
        writeTerminalOutput(term, output, snapshotPersister);
        if (prompted) return;
        prompted = true;
        promptRemove();
        removePrompt = null;
        removeData = api.onData(sessionId, (nextOutput: string) => {
          writeTerminalOutput(term, nextOutput, snapshotPersister);
          captureTerminalOutput(nextOutput);
        });
        setTimeout(() => {
          api.write(sessionId, `${command}\n`);
          if (isCodingAgentCommand(command)) startCodingAgentHint();
        }, 100);
        initialCommand.current = '';
      });
      removePrompt = promptRemove;
    } else {
      removeData = api.onData(sessionId, (output: string) => {
        writeTerminalOutput(term, output, snapshotPersister);
        captureTerminalOutput(output);
      });
    }

    term.onData((input: string) => {
      api.write(sessionId, input);
      captureTerminalInput(input);
    });
    term.onResize(({ cols, rows }) => {
      api.resize(sessionId, cols, rows);
    });
    saveTimerRef.current = setInterval(() => {
      void snapshotPersister.flush().catch(() => undefined);
    }, SCROLLBACK_SAVE_INTERVAL);
    cleanupRef.current = () => {
      spawnLifecycle.cancel(() => {
        removePrompt?.();
        removeData?.();
        removeExit();
      });
    };
    killSessionRef.current = () => {
      try {
        api.kill(sessionId, result.leaseId);
      } finally {
        sessionOwner.finishFinalization();
      }
    };
  }, [
    arbitrateTerminalKey,
    captureTerminalInput,
    captureTerminalOutput,
    readOnly,
    rootFolder,
    sessionId,
    startCodingAgentHint,
  ]);

  useEffect(() => {
    void initTerminal();
    return () => {
      if (saveTimerRef.current) clearInterval(saveTimerRef.current);
      const persister = snapshotPersisterRef.current;
      const term = termRef.current;
      const killSession = killSessionRef.current;
      cleanupRef.current?.();
      if (!readOnly && persister && term) {
        finalizeTerminalSnapshotBeforeDispose(term, persister, () => {
          killSession?.();
          term.dispose();
        });
      } else {
        killSession?.();
        term?.dispose();
      }
      termRef.current = null;
      fitRef.current = null;
      spawnedRef.current = false;
      cleanupRef.current = null;
      killSessionRef.current = null;
      snapshotPersisterRef.current = null;
    };
    // The terminal session is intentionally bound to its first mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!fitRef.current) return;
    const refit = createDebouncedTerminalRefit(() => {
      fitTerminalWithCanvasScale(termRef.current, fitRef.current, containerRef.current);
    });
    const observer = new ResizeObserver(refit.schedule);
    if (containerRef.current) observer.observe(containerRef.current);
    return () => {
      observer.disconnect();
      refit.cancel();
    };
  }, []);

  const handleMentionSelect = useCallback((selected: CanvasNode) => {
    if (readOnly) return;
    setPickerOpen(false);
    const api = window.canvasWorkspace?.pty;
    if (api) void api.write(sessionId, buildNodeMentionInsertion(selected));
    termRef.current?.focus();
  }, [readOnly, sessionId]);

  const handleMentionClose = useCallback(() => {
    setPickerOpen(false);
    termRef.current?.focus();
  }, []);

  return {
    containerRef,
    pickerOpen,
    mentionHintVisible,
    dismissMentionHint,
    handleMentionSelect,
    handleMentionClose,
  };
}
