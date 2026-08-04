/**
 * A PTY session's environment — `PULSE_CANVAS_WORKSPACE_ID` included — is
 * frozen by the OS at spawn and can never be updated afterwards. `pty:spawn`
 * hands back a live session whenever the requested id already exists, so a
 * session id that ends up shared by nodes in two different workspaces makes
 * the second node silently attach to the first node's shell: same scrollback,
 * same cwd, and a `pulse-canvas` CLI that resolves every command against the
 * FIRST workspace.
 *
 * Node ids and the persisted `data.sessionId` are copied verbatim by workspace
 * export → import, so that collision is reachable without any id-generation
 * bug. Reuse is only safe while the requested workspace matches the one the
 * session was spawned for.
 */
export type PtySessionReuseDecision =
  | { reuse: true }
  | {
      reuse: false;
      code: 'workspace_mismatch';
      boundWorkspaceId: string;
      requestedWorkspaceId: string;
    };

/**
 * Decide whether a live PTY session may be handed to a new spawn request.
 *
 * An unknown workspace on either side (sessions spawned before the caller
 * carried a workspace, e.g. plain terminal nodes) stays reusable — this guard
 * only rejects a *known* cross-workspace bind, never a merely unlabelled one.
 */
export const decidePtySessionReuse = (
  boundWorkspaceId: string | undefined,
  requestedWorkspaceId: string | undefined,
): PtySessionReuseDecision => {
  if (!boundWorkspaceId || !requestedWorkspaceId) return { reuse: true };
  if (boundWorkspaceId === requestedWorkspaceId) return { reuse: true };
  return {
    reuse: false,
    code: 'workspace_mismatch',
    boundWorkspaceId,
    requestedWorkspaceId,
  };
};

/** User-facing explanation for a refused cross-workspace reuse. */
export const describePtySessionReuseRefusal = (
  sessionId: string,
  decision: Extract<PtySessionReuseDecision, { reuse: false }>,
): string =>
  `Terminal session "${sessionId}" is already live in workspace ` +
  `${decision.boundWorkspaceId}; refusing to reuse it for ` +
  `${decision.requestedWorkspaceId}. Restart this node to get a fresh session.`;
