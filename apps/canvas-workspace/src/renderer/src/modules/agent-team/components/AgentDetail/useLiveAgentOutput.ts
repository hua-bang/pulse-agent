import { useEffect, useState } from 'react';

const POLL_MS = 2_000;
const MAX_CHARS = 20_000;

/**
 * Polls main's in-memory output for a Coding Agent session. Agent output is
 * not saved on the canvas, so the node's data no longer carries it.
 */
export const useLiveAgentOutput = (sessionId: string | undefined): string | undefined => {
  const [output, setOutput] = useState<string | undefined>(undefined);

  useEffect(() => {
    setOutput(undefined);
    const read = window.canvasWorkspace?.pty?.getScrollback;
    if (!sessionId || !read) return;
    let active = true;
    const poll = () => {
      void read(sessionId, MAX_CHARS).then(
        (result) => { if (active && result.ok) setOutput(result.text ?? ''); },
        () => undefined,
      );
    };
    poll();
    const timer = window.setInterval(poll, POLL_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [sessionId]);

  return output;
};
