import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import type { AgentStatus } from '../../types';

interface Props {
  teammateId: string;
  status: AgentStatus;
}

const TERMINAL_OPTIONS = {
  fontSize: 12,
  fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
  lineHeight: 1.3,
  cursorBlink: true,
  scrollback: 5000,
  theme: {
    background: '#1e1e2e',
    foreground: '#cdd6f4',
    cursor: '#f5e0dc',
    selectionBackground: '#585b7066',
    black: '#45475a',
    red: '#f38ba8',
    green: '#a6e3a1',
    yellow: '#f9e2af',
    blue: '#89b4fa',
    magenta: '#f5c2e7',
    cyan: '#94e2d5',
    white: '#bac2de',
  },
};

export const AgentTerminal = ({ teammateId, status }: Props) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  const isActive = status === 'running' || status === 'waiting' || status === 'completed' || status === 'failed';

  useEffect(() => {
    if (!containerRef.current || !isActive || !teammateId) return;

    const term = new Terminal(TERMINAL_OPTIONS);
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    termRef.current = term;
    fitRef.current = fitAddon;

    // Fit to container
    try { fitAddon.fit(); } catch { /* ignore initial fit errors */ }

    const api = window.canvasWorkspace?.agentTeam;
    if (!api) return;

    // Agent output → xterm
    const unsubOutput = api.onOutput(teammateId, (data: string) => {
      term.write(data);
    });

    // xterm input → agent
    const disposable = term.onData((data: string) => {
      api.input(teammateId, data);
    });

    cleanupRef.current = () => {
      unsubOutput();
      disposable.dispose();
    };

    return () => {
      cleanupRef.current?.();
      cleanupRef.current = null;
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [teammateId, isActive]);

  // Resize observer
  useEffect(() => {
    if (!containerRef.current) return;

    const observer = new ResizeObserver(() => {
      if (fitRef.current) {
        try { fitRef.current.fit(); } catch { /* ignore */ }
      }
      if (termRef.current && fitRef.current) {
        const api = window.canvasWorkspace?.agentTeam;
        if (api) {
          api.resize(teammateId, termRef.current.cols, termRef.current.rows);
        }
      }
    });

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [teammateId]);

  if (!isActive) {
    return (
      <div className="agent-terminal-placeholder">
        <div className="agent-terminal-idle">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" opacity="0.3">
            <rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.5" />
            <path d="M7 12l3 2-3 2M13 16h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>Terminal will activate when agent starts</span>
        </div>
      </div>
    );
  }

  return (
    <div className="agent-terminal-container">
      <div ref={containerRef} className="agent-terminal-xterm" />
    </div>
  );
};
