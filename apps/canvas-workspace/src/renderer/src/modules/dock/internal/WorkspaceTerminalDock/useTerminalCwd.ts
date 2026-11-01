import { useCallback, useEffect, useRef, useState } from 'react';

/** Quiet time after shell output before the folder is read again. */
const OUTPUT_SETTLE_MS = 400;

interface TerminalCwdOptions {
  sessionId: string;
  rootFolder?: string;
  /** Folder saved for this tab before a restart; the new shell starts here. */
  initialCwd?: string;
  onCwdChange?: (cwd: string) => void;
}

/**
 * Owns the folder shown in the terminal header. `spawnCwd` picks where a new
 * shell starts; `refreshCwd` asks the pty for the shell's folder and reports a
 * change, so the dock can restore the tab in the same folder after a restart.
 * A read right after Enter can run before the command changes folder (for
 * example `sleep 1; cd /tmp`), so `noteOutput` reads again once output settles,
 * which is when the shell prints its next prompt.
 */
export function useTerminalCwd({ sessionId, rootFolder, initialCwd, onCwdChange }: TerminalCwdOptions) {
  const [cwd, setCwd] = useState(initialCwd || rootFolder || '');
  // Read at spawn time only; later prop changes must not restart the shell.
  const initialCwdRef = useRef(initialCwd);
  const rootFolderRef = useRef(rootFolder);
  rootFolderRef.current = rootFolder;
  const onCwdChangeRef = useRef(onCwdChange);
  onCwdChangeRef.current = onCwdChange;

  const spawnCwd = useCallback((): string | undefined => {
    const folder = initialCwdRef.current || rootFolderRef.current || undefined;
    if (folder) setCwd(folder);
    return folder;
  }, []);

  const refreshCwd = useCallback(() => {
    const api = window.canvasWorkspace?.pty;
    if (!api) return;
    void api.getCwd(sessionId).then((result) => {
      if (!result.ok || !result.cwd) return;
      setCwd(result.cwd);
      onCwdChangeRef.current?.(result.cwd);
    });
  }, [sessionId]);

  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noteOutput = useCallback(() => {
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    settleTimerRef.current = setTimeout(() => {
      settleTimerRef.current = null;
      refreshCwd();
    }, OUTPUT_SETTLE_MS);
  }, [refreshCwd]);

  useEffect(() => () => {
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
  }, []);

  return { cwd, spawnCwd, refreshCwd, noteOutput };
}
