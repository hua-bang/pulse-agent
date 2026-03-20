import { useEffect, useRef, useCallback, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import type { CanvasNode, FileNodeData, TerminalNodeData } from "../types";

interface Props {
  node: CanvasNode;
  allNodes: CanvasNode[];
  onUpdate: (id: string, patch: Partial<CanvasNode>) => void;
}

const SCROLLBACK_SAVE_INTERVAL = 2000;
const MAX_SCROLLBACK_CHARS = 50000;

const serializeBuffer = (term: Terminal): string => {
  const buf = term.buffer.active;
  const lines: string[] = [];
  const count = buf.length;
  for (let i = 0; i < count; i++) {
    const line = buf.getLine(i);
    if (line) {
      lines.push(line.translateToString(true));
    }
  }
  let text = lines.join("\n");
  text = text.replace(/\n+$/, "");
  if (text.length > MAX_SCROLLBACK_CHARS) {
    text = text.slice(-MAX_SCROLLBACK_CHARS);
  }
  return text;
};

export const TerminalNodeBody = ({ node, allNodes, onUpdate }: Props) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const spawnedRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const data = node.data as TerminalNodeData;
  const sessionId = data.sessionId || node.id;
  const nodeIdRef = useRef(node.id);
  nodeIdRef.current = node.id;
  const dataRef = useRef(data);
  dataRef.current = data;
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;
  const allNodesRef = useRef(allNodes);
  allNodesRef.current = allNodes;
  const [injecting, setInjecting] = useState(false);
  const initialScrollback = useRef(data.scrollback ?? "");
  const initialCwd = useRef(data.cwd ?? "");

  const persistState = useCallback(() => {
    const term = termRef.current;
    const scrollback = term
      ? serializeBuffer(term)
      : dataRef.current.scrollback;
    onUpdateRef.current(nodeIdRef.current, {
      data: {
        sessionId: dataRef.current.sessionId,
        scrollback,
        cwd: dataRef.current.cwd
      }
    });
  }, []);

  const injectCanvasContext = useCallback(async () => {
    const term = termRef.current;
    const api = window.canvasWorkspace;
    if (!term || !api || injecting) return;
    setInjecting(true);

    try {
      const allNodes = allNodesRef.current;
      const fileNodes = allNodes.filter((n) => n.type === 'file');
      const otherTerminals = allNodes.filter(
        (n) => n.type === 'terminal' && n.id !== nodeIdRef.current
      );

      // Build markdown context
      let md = `# Canvas Context\n\n_Generated: ${new Date().toLocaleString()}_\n\n`;

      if (fileNodes.length > 0) {
        md += `## File Nodes\n\n`;
        for (const n of fileNodes) {
          const d = n.data as FileNodeData;
          md += `### ${n.title}\n`;
          if (d.filePath) md += `_Path: ${d.filePath}_\n\n`;
          md += (d.content?.trim() || '_Empty_') + '\n\n---\n\n';
        }
      }

      if (otherTerminals.length > 0) {
        md += `## Other Terminals\n\n`;
        for (const n of otherTerminals) {
          md += `- **${n.title}**\n`;
        }
        md += '\n';
      }

      if (fileNodes.length === 0 && otherTerminals.length === 0) {
        md += '_No other nodes on canvas._\n';
      }

      // Write to .canvas-context.md in terminal CWD
      const cwdResult = await api.pty.getCwd(sessionId);
      const cwd = (cwdResult.ok && cwdResult.cwd) ? cwdResult.cwd : '.';
      const contextPath = `${cwd}/.canvas-context.md`;
      await api.file.write(contextPath, md);

      // Display summary in terminal
      term.writeln('\r\n\x1b[36m┌─ Canvas Context ─────────────────────────────┐\x1b[0m');
      if (fileNodes.length > 0) {
        for (const n of fileNodes) {
          const label = n.title.slice(0, 38).padEnd(38);
          term.writeln(`\x1b[36m│\x1b[0m  \x1b[33m📄\x1b[0m ${label} \x1b[36m│\x1b[0m`);
        }
      }
      if (otherTerminals.length > 0) {
        for (const n of otherTerminals) {
          const label = n.title.slice(0, 38).padEnd(38);
          term.writeln(`\x1b[36m│\x1b[0m  \x1b[32m💻\x1b[0m ${label} \x1b[36m│\x1b[0m`);
        }
      }
      if (fileNodes.length === 0 && otherTerminals.length === 0) {
        term.writeln(`\x1b[36m│\x1b[0m  \x1b[2m(no other nodes)\x1b[0m                            \x1b[36m│\x1b[0m`);
      }
      term.writeln(`\x1b[36m└── Written to: .canvas-context.md ────────────┘\x1b[0m\r\n`);
    } catch (err) {
      term.writeln(`\r\n\x1b[31m[canvas-context] Error: ${String(err)}\x1b[0m\r\n`);
    } finally {
      setInjecting(false);
    }
  }, [sessionId, injecting]);

  const initTerminal = useCallback(async () => {
    if (!containerRef.current || termRef.current || spawnedRef.current) return;
    spawnedRef.current = true;

    const term = new Terminal({
      fontSize: 12,
      lineHeight: 1.4,
      letterSpacing: 0,
      fontFamily: "'SF Mono', 'Fira Code', Menlo, 'Cascadia Code', monospace",
      theme: {
        background: "#fafaf9",
        foreground: "#37352f",
        cursor: "#37352f",
        cursorAccent: "#fafaf9",
        selectionBackground: "rgba(35, 131, 226, 0.15)",
        selectionForeground: "#37352f",
        black: "#37352f",
        red: "#eb5757",
        green: "#0f7b6c",
        yellow: "#d9730d",
        blue: "#2383e2",
        magenta: "#9065b0",
        cyan: "#0f7b6c",
        white: "#787774",
        brightBlack: "#787774",
        brightRed: "#eb5757",
        brightGreen: "#0f7b6c",
        brightYellow: "#d9730d",
        brightBlue: "#2383e2",
        brightMagenta: "#9065b0",
        brightCyan: "#0f7b6c",
        brightWhite: "#37352f"
      },
      cursorBlink: true,
      cursorStyle: "bar",
      allowTransparency: true,
      scrollback: 5000,
      smoothScrollDuration: 100
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);

    termRef.current = term;
    fitRef.current = fitAddon;

    if (initialScrollback.current) {
      term.writeln("\x1b[2m--- session restored ---\x1b[0m");
      term.writeln(initialScrollback.current);
      term.writeln("\x1b[2m--- new session ---\x1b[0m\r\n");
    }

    requestAnimationFrame(() => {
      try {
        fitAddon.fit();
      } catch {
        // ignore
      }
    });

    const api = window.canvasWorkspace?.pty;
    if (!api) {
      term.writeln(
        "\x1b[31mError: pty API not available (preload missing)\x1b[0m"
      );
      return;
    }

    const spawnCwd = initialCwd.current || undefined;
    const result = await api.spawn(sessionId, term.cols, term.rows, spawnCwd);
    if (!result.ok) {
      term.writeln(`\x1b[31mFailed to spawn shell: ${result.error}\x1b[0m`);
      return;
    }

    const removeData = api.onData(sessionId, (d: string) => {
      term.write(d);
    });

    const removeExit = api.onExit(sessionId, (code: number) => {
      term.writeln(`\r\n\x1b[2m[Process exited with code ${code}]\x1b[0m`);
    });

    term.onData((d: string) => {
      api.write(sessionId, d);
    });

    term.onResize(({ cols, rows }) => {
      api.resize(sessionId, cols, rows);
    });

    // Periodically save scrollback + cwd
    saveTimerRef.current = setInterval(async () => {
      const scrollback = serializeBuffer(term);
      const cwdResult = await api.getCwd(sessionId);
      const cwd =
        cwdResult.ok && cwdResult.cwd ? cwdResult.cwd : dataRef.current.cwd;
      onUpdateRef.current(nodeIdRef.current, {
        data: { sessionId: dataRef.current.sessionId, scrollback, cwd }
      });
    }, SCROLLBACK_SAVE_INTERVAL);

    cleanupRef.current = () => {
      removeData();
      removeExit();
      api.kill(sessionId);
    };
  }, [sessionId, persistState]);

  useEffect(() => {
    void initTerminal();
    return () => {
      // Save final state
      const api = window.canvasWorkspace?.pty;
      if (termRef.current && api) {
        const scrollback = serializeBuffer(termRef.current);
        void api.getCwd(sessionId).then((r) => {
          const cwd =
            r.ok && r.cwd ? r.cwd : dataRef.current.cwd;
          onUpdateRef.current(nodeIdRef.current, {
            data: {
              sessionId: dataRef.current.sessionId,
              scrollback,
              cwd
            }
          });
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
    const observer = new ResizeObserver(() => {
      try {
        fitRef.current?.fit();
      } catch {
        // ignore
      }
    });
    if (containerRef.current) {
      observer.observe(containerRef.current);
    }
    return () => observer.disconnect();
  }, []);

  return (
    <div className="terminal-body-wrap">
      <div
        ref={containerRef}
        className="terminal-xterm-container"
        onMouseDown={(e) => e.stopPropagation()}
      />
      <button
        className={`terminal-ctx-btn${injecting ? ' terminal-ctx-btn--active' : ''}`}
        title="Inject canvas context into terminal"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={injectCanvasContext}
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
          <rect x="1.5" y="1.5" width="8" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
          <path d="M5.5 5h3M5.5 7.5h2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
          <path d="M10.5 8v5.5M10.5 13.5l-2-2M10.5 13.5l2-2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
    </div>
  );
};
