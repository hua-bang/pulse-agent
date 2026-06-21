import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { TERMINAL_OPTIONS } from '../../config/terminalTheme';
import type { CanvasNode, FileNodeData } from '../../types';
import { AI_TOOL_PATTERN, writeCanvasContext } from '../../utils/canvasContextWriter';
import { NodeMentionPicker } from '../NodeMentionPicker';
import { useI18n } from '../../i18n';
import './index.css';

interface WorkspaceTerminalDockProps {
  workspaceId: string;
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
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const spawnedRef = useRef(false);
  const nodesRef = useRef(nodes);
  const rootFolderRef = useRef(rootFolder);
  const workspaceNameRef = useRef(workspaceName);
  nodesRef.current = nodes;
  rootFolderRef.current = rootFolder;
  workspaceNameRef.current = workspaceName;
  heightRef.current = height;

  const sessionId = useMemo(() => `workspace-terminal:${workspaceId}`, [workspaceId]);

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

  const refreshCwd = useCallback(() => {
    const api = window.canvasWorkspace?.pty;
    if (!api) return;
    void api.getCwd(sessionId).then((result) => {
      if (result.ok && result.cwd) setCwd(result.cwd);
    });
  }, [sessionId]);

  const initTerminal = useCallback(async () => {
    if (!containerRef.current || termRef.current || spawnedRef.current) return;
    spawnedRef.current = true;

    const term = new Terminal(TERMINAL_OPTIONS);
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    termRef.current = term;
    fitRef.current = fitAddon;
    scheduleFit();

    term.attachCustomKeyEventHandler((event: KeyboardEvent) => {
      if (event.type === 'keydown' && event.key === '2' && (event.ctrlKey || event.metaKey) && !event.altKey) {
        setPickerOpen(true);
        return false;
      }
      return true;
    });

    const api = window.canvasWorkspace?.pty;
    if (!api) {
      term.writeln('\x1b[31mError: pty API not available\x1b[0m');
      return;
    }

    const spawnCwd = rootFolderRef.current || undefined;
    if (spawnCwd) setCwd(spawnCwd);
    const result = await api.spawn(sessionId, term.cols, term.rows, spawnCwd, workspaceId);
    if (!result.ok) {
      term.writeln(`\x1b[31mFailed to spawn shell: ${result.error}\x1b[0m`);
      return;
    }

    const removeData = api.onData(sessionId, (data) => {
      term.write(data);
    });
    const removeExit = api.onExit(sessionId, (code) => {
      term.writeln(`\r\n\x1b[2m[Process exited with code ${code}]\x1b[0m`);
    });

    let inputBuf = '';
    const inputDisposable = term.onData((data) => {
      api.write(sessionId, data);
      if (data === '\r' || data === '\n') {
        const command = inputBuf.trim();
        inputBuf = '';
        refreshCwd();
        const contextNodes = nodesRef.current;
        if (AI_TOOL_PATTERN.test(command) && contextNodes.length > 0) {
          void api.getCwd(sessionId).then((result) => {
            const nextCwd = result.ok && result.cwd ? result.cwd : rootFolderRef.current;
            if (nextCwd) {
              void writeCanvasContext(
                contextNodes,
                nextCwd,
                workspaceId,
                workspaceNameRef.current,
                term,
              );
            }
          });
        }
      } else if (data === '\x7f') {
        inputBuf = inputBuf.slice(0, -1);
      } else if (data.length === 1 && data >= ' ') {
        inputBuf += data;
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
  }, [refreshCwd, scheduleFit, sessionId, workspaceId]);

  useEffect(() => {
    if (!open) return;
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
      const filePath = selected.type === 'file'
        ? (selected.data as FileNodeData).filePath
        : undefined;
      const label = filePath ? filePath.split('/').pop() : selected.title;
      api.write(sessionId, `@[${label}](canvas:${selected.id})`);
    }
    termRef.current?.focus();
  }, [sessionId]);

  const handleMentionClose = useCallback(() => {
    setPickerOpen(false);
    termRef.current?.focus();
  }, []);

  const displayedCwd = compactPath(cwd || '~');
  const title = placement === 'pane'
    ? (workspaceName || t('workspaceTerminal.title'))
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
      </div>
    </section>
  );
};
