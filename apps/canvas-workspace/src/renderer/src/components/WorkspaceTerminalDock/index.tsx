import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import {
  BASE_TERMINAL_FONT_SIZE,
  TERMINAL_FONT_SIZE_STEP,
  TERMINAL_OPTIONS,
  clampTerminalFontSize,
  readStoredTerminalFontSize,
  storeTerminalFontSize,
} from '../../config/terminalTheme';
import type { CanvasNode } from '../../types';
import { buildNodeMentionInsertion } from '../../utils/nodeMention';
import { NodeMentionPicker, NODE_MENTION_SHORTCUT } from '../NodeMentionPicker';
import { MentionTriggerButton } from '../NodeMentionPicker/MentionTriggerButton';
import { useI18n } from '../../i18n';
import { TERMINAL_TAB_ID } from '../RightDock/dock-store';
import {
  appendTerminalOutputTail,
  hasLikelyReturnedToShellPrompt,
  isCodingAgentCommand,
} from '../../utils/codingAgentCommand';
import './index.css';

interface WorkspaceTerminalDockProps {
  workspaceId: string;
  terminalId?: string;
  terminalTitle?: string;
  workspaceName?: string;
  rootFolder?: string;
  nodes: CanvasNode[];
  open: boolean;
  onClose: () => void;
  placement?: 'bottom' | 'pane';
}

const HEIGHT_STORAGE_KEY = 'canvas-workspace:workspace-terminal-height';
const DEFAULT_HEIGHT = 300;
const MIN_HEIGHT = 180;
const MAX_VIEWPORT_RATIO = 0.58;
const RESIZING_CLASS = 'workspace-terminal-resizing';

function readStoredHeight(): number | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(HEIGHT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function clampHeight(value: number): number {
  const viewportHeight = typeof window === 'undefined' ? DEFAULT_HEIGHT * 2 : window.innerHeight;
  const max = Math.max(MIN_HEIGHT, Math.round(viewportHeight * MAX_VIEWPORT_RATIO));
  return Math.min(max, Math.max(MIN_HEIGHT, value));
}

function compactPath(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 56) return trimmed;
  const parts = trimmed.split('/').filter(Boolean);
  if (parts.length <= 3) return trimmed;
  return `.../${parts.slice(-3).join('/')}`;
}

export const WorkspaceTerminalDock = ({
  workspaceId,
  terminalId = TERMINAL_TAB_ID,
  terminalTitle,
  workspaceName,
  rootFolder,
  nodes,
  open,
  onClose,
  placement = 'bottom',
}: WorkspaceTerminalDockProps) => {
  const { t } = useI18n();
  const [height, setHeight] = useState(() => clampHeight(readStoredHeight() ?? DEFAULT_HEIGHT));
  const heightRef = useRef(height);
  const [cwd, setCwd] = useState(rootFolder ?? '');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [mentionHintVisible, setMentionHintVisible] = useState(false);
  // True from the moment the dock opens until the shell prints its first
  // byte — drives the boot overlay so init doesn't read as a blank white panel.
  const [booting, setBooting] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const fontSizeRef = useRef<number>(readStoredTerminalFontSize());
  const cleanupRef = useRef<(() => void) | null>(null);
  const spawnedRef = useRef(false);
  const codingAgentActiveRef = useRef(false);
  const commandInputRef = useRef('');
  const terminalOutputTailRef = useRef('');
  const nodesRef = useRef(nodes);
  const rootFolderRef = useRef(rootFolder);
  nodesRef.current = nodes;
  rootFolderRef.current = rootFolder;
  heightRef.current = height;

  const sessionId = useMemo(
    () => terminalId === TERMINAL_TAB_ID
      ? `workspace-terminal:${workspaceId}`
      : `workspace-terminal:${workspaceId}:${terminalId}`,
    [terminalId, workspaceId],
  );

  const fitTerminal = useCallback(() => {
    const term = termRef.current;
    const fitAddon = fitRef.current;
    const api = window.canvasWorkspace?.pty;
    if (!term || !fitAddon || !api || !open) return;
    try {
      fitAddon.fit();
      api.resize(sessionId, term.cols, term.rows);
    } catch {
      // Fit can fail while the dock is mid-transition or hidden.
    }
  }, [open, sessionId]);

  const scheduleFit = useCallback(() => {
    requestAnimationFrame(fitTerminal);
    setTimeout(fitTerminal, 80);
    setTimeout(fitTerminal, 240);
  }, [fitTerminal]);

  // Apply a new font size (Ctrl +/- zoom), then re-fit so cols/rows track the
  // new glyph metrics, and persist the preference for the next session.
  const applyFontSize = useCallback((next: number) => {
    const term = termRef.current;
    if (!term) return;
    const clamped = clampTerminalFontSize(next);
    if (term.options.fontSize === clamped) return;
    fontSizeRef.current = clamped;
    term.options.fontSize = clamped;
    storeTerminalFontSize(clamped);
    fitTerminal();
  }, [fitTerminal]);

  const refreshCwd = useCallback(() => {
    const api = window.canvasWorkspace?.pty;
    if (!api) return;
    void api.getCwd(sessionId).then((result) => {
      if (result.ok && result.cwd) setCwd(result.cwd);
    });
  }, [sessionId]);

  const dismissMentionHint = useCallback(() => {
    setMentionHintVisible(false);
  }, []);

  const finishCodingAgentHint = useCallback(() => {
    codingAgentActiveRef.current = false;
    terminalOutputTailRef.current = '';
    setMentionHintVisible(false);
  }, []);

  const startCodingAgentHint = useCallback(() => {
    if (codingAgentActiveRef.current) return;
    codingAgentActiveRef.current = true;
    terminalOutputTailRef.current = '';
    setMentionHintVisible(true);
  }, []);

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
    spawnedRef.current = true;

    const term = new Terminal({ ...TERMINAL_OPTIONS, fontSize: fontSizeRef.current });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    termRef.current = term;
    fitRef.current = fitAddon;
    // Size to the real container before spawning so the shell starts at the
    // correct cols/rows, rather than the 80×24 default that then reflows on the
    // first scheduled fit.
    try { fitAddon.fit(); } catch { /* container may be mid-layout */ }
    scheduleFit();

    term.attachCustomKeyEventHandler((event: KeyboardEvent) => {
      if (event.type !== 'keydown') return true;
      const withModifier = (event.ctrlKey || event.metaKey) && !event.altKey;
      if (event.key === '2' && withModifier) {
        setPickerOpen(true);
        return false;
      }
      // Ctrl/Cmd +/- to zoom the terminal font, Ctrl/Cmd+0 to reset.
      if (withModifier) {
        if (event.key === '=' || event.key === '+') {
          applyFontSize(fontSizeRef.current + TERMINAL_FONT_SIZE_STEP);
          return false;
        }
        if (event.key === '-' || event.key === '_') {
          applyFontSize(fontSizeRef.current - TERMINAL_FONT_SIZE_STEP);
          return false;
        }
        if (event.key === '0') {
          applyFontSize(BASE_TERMINAL_FONT_SIZE);
          return false;
        }
      }
      return true;
    });

    const api = window.canvasWorkspace?.pty;
    if (!api) {
      setBooting(false);
      term.writeln('\x1b[31mError: pty API not available\x1b[0m');
      return;
    }

    const spawnCwd = rootFolderRef.current || undefined;
    if (spawnCwd) setCwd(spawnCwd);
    const result = await api.spawn(sessionId, term.cols, term.rows, spawnCwd, workspaceId);
    if (!result.ok) {
      setBooting(false);
      term.writeln(`\x1b[31mFailed to spawn shell: ${result.error}\x1b[0m`);
      return;
    }

    const removeData = api.onData(sessionId, (data) => {
      // First byte means the shell is alive — drop the boot overlay.
      setBooting(false);
      term.write(data);
      captureTerminalOutput(data);
    });
    const removeExit = api.onExit(sessionId, (code) => {
      setBooting(false);
      term.writeln(`\r\n\x1b[2m[Process exited with code ${code}]\x1b[0m`);
    });

    const inputDisposable = term.onData((data) => {
      api.write(sessionId, data);
      captureTerminalInput(data);
      if (data === '\r' || data === '\n') {
        refreshCwd();
      }
    });
    const resizeDisposable = term.onResize(({ cols, rows }) => {
      api.resize(sessionId, cols, rows);
    });

    cleanupRef.current = () => {
      removeData();
      removeExit();
      inputDisposable.dispose();
      resizeDisposable.dispose();
      api.kill(sessionId);
    };
  }, [applyFontSize, captureTerminalInput, captureTerminalOutput, refreshCwd, scheduleFit, sessionId, workspaceId]);

  useEffect(() => {
    if (!open) return;
    // Show the boot overlay right away on the first open (before the async
    // spawn); once the terminal exists this is a no-op.
    if (!termRef.current) setBooting(true);
    void initTerminal();
    scheduleFit();
  }, [initTerminal, open, scheduleFit]);

  useEffect(() => {
    if (!open) return;
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(scheduleFit);
    observer.observe(container);
    return () => observer.disconnect();
  }, [open, scheduleFit]);

  useEffect(() => {
    const handleResize = () => {
      setHeight((current) => clampHeight(current));
      scheduleFit();
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [scheduleFit]);

  useEffect(() => {
    return () => {
      cleanupRef.current?.();
      termRef.current?.dispose();
      termRef.current = null;
      fitRef.current = null;
      spawnedRef.current = false;
      cleanupRef.current = null;
    };
  }, []);

  const handleResizeStart = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = height;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const nextHeight = clampHeight(startHeight + (startY - moveEvent.clientY));
      heightRef.current = nextHeight;
      setHeight(nextHeight);
      scheduleFit();
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.documentElement.classList.remove(RESIZING_CLASS);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      try {
        window.localStorage.setItem(HEIGHT_STORAGE_KEY, String(heightRef.current));
      } catch {
        // Height preference is best-effort.
      }
      scheduleFit();
    };

    document.documentElement.classList.add(RESIZING_CLASS);
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [height, scheduleFit]);

  const handleMentionSelect = useCallback((selected: CanvasNode) => {
    setPickerOpen(false);
    const api = window.canvasWorkspace?.pty;
    if (api) {
      api.write(sessionId, buildNodeMentionInsertion(selected));
    }
    termRef.current?.focus();
  }, [sessionId]);

  const handleMentionClose = useCallback(() => {
    setPickerOpen(false);
    termRef.current?.focus();
  }, []);

  const displayedCwd = compactPath(cwd || '~');
  const title = placement === 'pane'
    ? (terminalTitle || workspaceName || t('workspaceTerminal.title'))
    : t('workspaceTerminal.title');

  return (
    <section
      className={`workspace-terminal-dock workspace-terminal-dock--${placement}`}
      data-open={open}
      style={placement === 'bottom' ? { height: open ? height : 0 } : undefined}
      aria-label={t('workspaceTerminal.ariaLabel')}
      onMouseDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      <div
        className="workspace-terminal-dock__resize"
        role="separator"
        aria-orientation="horizontal"
        aria-label={t('workspaceTerminal.resize')}
        onMouseDown={handleResizeStart}
      />
      {placement === 'bottom' && (
        <div className="workspace-terminal-dock__header">
          <div className="workspace-terminal-dock__title">
            <span className="workspace-terminal-dock__status" />
            <strong>{title}</strong>
            {workspaceName && <span>{workspaceName}</span>}
          </div>
          <code className="workspace-terminal-dock__cwd" title={cwd || '~'}>{displayedCwd}</code>
          <button
            type="button"
            className="workspace-terminal-dock__close"
            aria-label={t('workspaceTerminal.close')}
            title={t('workspaceTerminal.close')}
            onClick={onClose}
          >
            {t('workspaceTerminal.close')}
          </button>
        </div>
      )}
      <div className="workspace-terminal-dock__body" onClick={() => termRef.current?.focus()}>
        {pickerOpen && (
          <NodeMentionPicker
            nodes={nodesRef.current}
            onSelect={handleMentionSelect}
            onClose={handleMentionClose}
          />
        )}
        <div ref={containerRef} className="workspace-terminal-dock__xterm" />
        {mentionHintVisible && !pickerOpen && (
          <div className="workspace-terminal-dock__mention-hint" role="status">
            <span>{t('terminal.mentionHint.prefix')}</span>
            <kbd>{NODE_MENTION_SHORTCUT}</kbd>
            <span>{t('terminal.mentionHint.suffix')}</span>
            <button
              type="button"
              className="workspace-terminal-dock__mention-hint-close"
              aria-label={t('terminal.mentionHint.dismiss')}
              onClick={dismissMentionHint}
            >
              ×
            </button>
          </div>
        )}
        {!pickerOpen && !mentionHintVisible && (
          <MentionTriggerButton
            label={t('nodeMention.triggerLabel')}
            title={`${t('nodeMention.title')} · ${NODE_MENTION_SHORTCUT}`}
            onClick={() => setPickerOpen(true)}
          />
        )}
        {booting && (
          <div className="workspace-terminal-dock__booting" aria-hidden="true">
            <span className="workspace-terminal-dock__spinner" />
            <span>{t('workspaceTerminal.starting')}</span>
          </div>
        )}
      </div>
    </section>
  );
};
