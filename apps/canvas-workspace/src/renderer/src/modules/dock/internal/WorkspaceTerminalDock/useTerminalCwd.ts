import { useCallback, useRef, useState } from 'react';

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

  return { cwd, spawnCwd, refreshCwd };
}
