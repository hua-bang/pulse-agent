import { useEffect, useRef, useCallback, useState } from 'react';
import '@xterm/xterm/css/xterm.css';
import './index.css';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import type { CanvasNode, TerminalNodeData } from '../../types';
import { TERMINAL_OPTIONS } from '../../config/terminalTheme';
import { buildNodeMentionInsertion } from '../../utils/nodeMention';
import { NodeMentionPicker } from '../NodeMentionPicker';
import { createDebouncedTerminalRefit, fitTerminalWithCanvasScale, syncTerminalFontSizeToCanvas } from '../AgentNodeBody/utils/terminal';
import { useI18n } from '../../i18n';
import {
  appendTerminalOutputTail,
  hasLikelyReturnedToShellPrompt,
  isCodingAgentCommand,
} from '../../utils/codingAgentCommand';

interface Props {
  node: CanvasNode;
  getAllNodes?: () => CanvasNode[];
  rootFolder?: string;
  workspaceId?: string;
  workspaceName?: string;
  onUpdate: (id: string, patch: Partial<CanvasNode>, options?: { history?: boolean }) => void;
  readOnly?: boolean;
}

const SCROLLBACK_SAVE_INTERVAL = 2000;
const MAX_SCROLLBACK_CHARS = 50000;

const serializeBuffer = (term: Terminal): string => {
  const buf = term.buffer.active;
  const lines: string[] = [];
  const count = buf.length;
  for (let i = 0; i < count; i++) {
    const line = buf.getLine(i);
    if (line) lines.push(line.translateToString(true));
  }
  let text = lines.join('\n');
  text = text.replace(/\n+$/, '');
  if (text.length > MAX_SCROLLBACK_CHARS) text = text.slice(-MAX_SCROLLBACK_CHARS);
  return text;
};

export const TerminalNodeBody = ({ node, getAllNodes, rootFolder, workspaceId, onUpdate, readOnly = false }: Props) => {
  const { t } = useI18n();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [mentionHintVisible, setMentionHintVisible] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const spawnedRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
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
  const getAllNodesRef = useRef(getAllNodes);
  getAllNodesRef.current = getAllNodes;
  const workspaceIdRef = useRef(workspaceId);
  workspaceIdRef.current = workspaceId;
  const initialScrollback = useRef(data.scrollback ?? '');
  const initialCwd = useRef(data.cwd ?? '');
  const initialCommand = useRef(data.initialCommand ?? '');

  const persistState = useCallback(() => {
    const term = termRef.current;
    const scrollback = term ? serializeBuffer(term) : dataRef.current.scrollback;
    onUpdateRef.current(nodeIdRef.current, {
      data: { sessionId: dataRef.current.sessionId, scrollback, cwd: dataRef.current.cwd },
    }, { history: false });
  }, []);

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

  const captureTerminalOutput = useCallback((data: string) => {
    if (!codingAgentActiveRef.current) return;
    terminalOutputTailRef.current = appendTerminalOutputTail(terminalOutputTailRef.current, data);
    if (hasLikelyReturnedToShellPrompt(terminalOutputTailRef.current)) {
      finishCodingAgentHint();
    }
  }, [finishCodingAgentHint]);

  const captureTerminalInput = useCallback((data: string) => {
    for (const ch of data) {
      if (ch === '\r' || ch === '\n') {
        const command = commandInputRef.current;
        commandInputRef.current = '';
        if (isCodingAgentCommand(command)) startCodingAgentHint();
      } else if (ch === '\x7f' || ch === '\b') {
        commandInputRef.current = commandInputRef.current.slice(0, -1);
      } else if (ch === '\x15') {
        commandInputRef.current = '';
      } else if (ch >= ' ') {
        commandInputRef.current += ch;
      }
    }
  }, [startCodingAgentHint]);

  const initTerminal = useCallback(async () => {
    if (!containerRef.current || termRef.current || spawnedRef.current) return;
    if (readOnly) {
      spawnedRef.current = true;
      const term = new Terminal(TERMINAL_OPTIONS);
      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(containerRef.current);
      termRef.current = term;
      fitRef.current = fitAddon;
      syncTerminalFontSizeToCanvas(term, containerRef.current);
      if (initialScrollback.current) {
        term.write(initialScrollback.current.split('\n').join('\r\n'));
      } else {
        term.writeln('\x1b[2m--- no saved terminal output ---\x1b[0m');
      }
      requestAnimationFrame(() => {
        fitTerminalWithCanvasScale(term, fitAddon, containerRef.current);
      });
      return;
    }
    spawnedRef.current = true;

    const term = new Terminal(TERMINAL_OPTIONS);
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    termRef.current = term;
    fitRef.current = fitAddon;
    syncTerminalFontSizeToCanvas(term, containerRef.current);

    if (initialScrollback.current) {
      const RESTORE_TAIL_LINES = 10;
      const lastLines = initialScrollback.current
        .split('\n')
        .slice(-RESTORE_TAIL_LINES)
        .join('\r\n');
      term.writeln('\x1b[2m--- session restored ---\x1b[0m');
      term.write(lastLines + '\r\n');
      term.writeln('\x1b[2m--- new session ---\x1b[0m\r\n');
    }

    term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
      if (e.type === 'keydown' && e.key === '2' && (e.ctrlKey || e.metaKey) && !e.altKey) {
        setPickerOpen(true);
        return false;
      }
      return true;
    });

    requestAnimationFrame(() => {
      fitTerminalWithCanvasScale(term, fitAddon, containerRef.current);
    });

    const api = window.canvasWorkspace?.pty;
    if (!api) {
      term.writeln('\x1b[31mError: pty API not available (preload missing)\x1b[0m');
      return;
    }

    const spawnCwd = initialCwd.current || rootFolder || undefined;
    const result = await api.spawn(sessionId, term.cols, term.rows, spawnCwd, workspaceIdRef.current);
    if (!result.ok) {
      term.writeln(`\x1b[31mFailed to spawn shell: ${result.error}\x1b[0m`);
      return;
    }

    const removeExit = api.onExit(sessionId, (code: number) => {
      term.writeln(`\r\n\x1b[2m[Process exited with code ${code}]\x1b[0m`);
    });

    // If an initial command is set, wait for the shell prompt before writing it.
    // Otherwise attach the data listener immediately.
    let removeData: (() => void) | null = null;
    let removePrompt: (() => void) | null = null;
    const cmdToRun = initialCommand.current;

    if (cmdToRun) {
      let prompted = false;
      const promptRemove = api.onData(sessionId, (d: string) => {
        term.write(d);
        if (!prompted) {
          prompted = true;
          promptRemove();
          removePrompt = null;
          removeData = api.onData(sessionId, (d2: string) => {
            term.write(d2);
            captureTerminalOutput(d2);
          });
          setTimeout(() => {
            api.write(sessionId, `${cmdToRun}\n`);
            if (isCodingAgentCommand(cmdToRun)) startCodingAgentHint();
          }, 100);
          // Clear so it doesn't re-run on session restore
          initialCommand.current = '';
        }
      });
      removePrompt = promptRemove;
    } else {
      removeData = api.onData(sessionId, (d: string) => {
        term.write(d);
        captureTerminalOutput(d);
      });
    }

    term.onData((d: string) => {
      api.write(sessionId, d);
      captureTerminalInput(d);
    });

    term.onResize(({ cols, rows }) => { api.resize(sessionId, cols, rows); });

    saveTimerRef.current = setInterval(async () => {
      const scrollback = serializeBuffer(term);
      const cwdResult = await api.getCwd(sessionId);
      const cwd = cwdResult.ok && cwdResult.cwd ? cwdResult.cwd : dataRef.current.cwd;
      onUpdateRef.current(nodeIdRef.current, {
        data: { sessionId: dataRef.current.sessionId, scrollback, cwd },
      }, { history: false });
    }, SCROLLBACK_SAVE_INTERVAL);

    cleanupRef.current = () => {
      // If the node unmounts before the shell prompt ever arrived, the
      // prompt listener is still registered — drop it too.
      removePrompt?.();
      removeData?.();
      removeExit();
      api.kill(sessionId);
    };
  }, [sessionId, rootFolder, persistState, readOnly, captureTerminalInput, captureTerminalOutput, startCodingAgentHint]);

  useEffect(() => {
    void initTerminal();
    return () => {
      const api = window.canvasWorkspace?.pty;
      if (readOnly) {
        // Reference previews render saved scrollback only; never persist or kill a live PTY.
      } else if (termRef.current && api) {
        const scrollback = serializeBuffer(termRef.current);
        void api.getCwd(sessionId).then((r) => {
          const cwd = r.ok && r.cwd ? r.cwd : dataRef.current.cwd;
          onUpdateRef.current(nodeIdRef.current, {
            data: { sessionId: dataRef.current.sessionId, scrollback, cwd },
          }, { history: false });
        });
      } else if (termRef.current) {
        persistState();
      }
      if (saveTimerRef.current) clearInterval(saveTimerRef.current);
      cleanupRef.current?.();
      termRef.current?.dispose();
      termRef.current = null;
      fitRef.current = null;
      spawnedRef.current = false;
      cleanupRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!fitRef.current) return;
    // The xterm container's CSS width/height resolve through
    // `calc(100% * var(--canvas-scale))`, so every canvas zoom change
    // triggers a layout-size change on the container, which in turn fires
    // this ResizeObserver. We piggy-back on it to keep the xterm font
    // size proportional to the canvas zoom and re-fit cols/rows.
    // Debounced: bursts (canvas fit animation, node drag-resize) settle
    // to a single refit instead of one per frame per terminal.
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
    if (api) {
      void api.write(sessionId, buildNodeMentionInsertion(selected));
    }
    termRef.current?.focus();
  }, [sessionId, readOnly]);

  const handleMentionClose = useCallback(() => {
    setPickerOpen(false);
    termRef.current?.focus();
  }, []);

  return (
    <div className="terminal-body-wrap">
      {!readOnly && pickerOpen && (
        <NodeMentionPicker
          nodes={getAllNodesRef.current?.() ?? []}
          onSelect={handleMentionSelect}
          onClose={handleMentionClose}
        />
      )}
      {!readOnly && mentionHintVisible && !pickerOpen && (
        <div className="terminal-mention-hint" role="status">
          <span>{t('terminal.mentionHint.prefix')}</span>
          <kbd>Ctrl/⌘+2</kbd>
          <span>{t('terminal.mentionHint.suffix')}</span>
          <button
            type="button"
            className="terminal-mention-hint__close"
            aria-label={t('terminal.mentionHint.dismiss')}
            onClick={dismissMentionHint}
          >
            ×
          </button>
        </div>
      )}
      <div
        ref={containerRef}
        className="terminal-xterm-container"
        onMouseDown={(e) => e.stopPropagation()}
        // Scrolling terminal output must not also pan the canvas underneath.
        onWheel={(e) => e.stopPropagation()}
      />
    </div>
  );
};
