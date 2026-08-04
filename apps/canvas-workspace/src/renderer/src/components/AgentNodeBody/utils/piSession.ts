/**
 * Binding a Coding Agent node to one Pi conversation.
 *
 * Pi accepts no caller-supplied session id, but `--session-dir` is a
 * first-class flag that scopes session storage AND lookup. Handing each node
 * its own directory makes `--continue` — "the most recent session in this
 * directory" — resolve to THIS node's conversation and nothing else: no id to
 * capture after launch, and no way to attach to a sibling node or to a `pi`
 * the user started by hand.
 *
 * Background and the rejected alternatives:
 * harness/knowledge/coding-agent-registry.md (§Binding a node to one conversation).
 */

const PI_AGENT_TYPE = 'pi';

/**
 * Nested two levels below `sessions/` on purpose: pi's cross-project session
 * list scans only the direct children of `sessions/`, so canvas conversations
 * stay out of the CLI's `pi -r` picker while remaining reachable by path.
 *
 * `$HOME` rather than `~` because pi expands a leading tilde for its
 * `PI_CODING_AGENT_SESSION_DIR` env var but NOT for `--session-dir`, so the
 * shell has to do it. (The env var is not an option anyway: `pty:spawn`
 * allowlists env keys to `PULSE_CANVAS_*`.) The key is a UUID, so the
 * double-quoted path can never carry shell syntax.
 */
export const piSessionDirArg = (key: string): string =>
  `"$HOME/.pi/agent/sessions/pulse-canvas/${key}"`;

export interface PiSessionBinding {
  /** Key to persist on the node; undefined for every non-Pi agent. */
  key?: string;
  /** Only a key the node ALREADY carried names a conversation worth resuming. */
  canResume: boolean;
  /** Launch flags for this binding. */
  flags: (resume: boolean) => string;
}

export const resolvePiSessionBinding = (
  agentType: string,
  savedKey: string | undefined,
): PiSessionBinding => {
  if (agentType !== PI_AGENT_TYPE) return { canResume: false, flags: () => '' };
  const key = savedKey || crypto.randomUUID();
  return {
    key,
    // A node whose first launch predates this binding has no saved key: its
    // earlier conversation sits in pi's default per-cwd directory and is not
    // addressable from here, so the first keyed launch starts fresh.
    canResume: !!savedKey,
    // --session-dir ships on EVERY launch, not just resumes: it is what puts
    // the conversation somewhere a later --continue can find it.
    flags: (resume: boolean) =>
      ` --session-dir ${piSessionDirArg(key)}${resume && savedKey ? ' --continue' : ''}`,
  };
};
