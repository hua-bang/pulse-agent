import { createContext, useContext } from 'react';

/**
 * Whether the enclosing workspace's canvas is the one currently visible.
 * Workbench keeps background workspaces mounted (`display:none`, keep-alive)
 * so switching back is instant — but that also means their node bodies
 * (e.g. AgentNodeBody/AgentTeamFrame's team-status polls) keep running for
 * a workspace the user can't even see. Threading `isActive` through every
 * CanvasSurface/CanvasNodeView layer down to those leaf components would
 * touch ~5 files for one boolean; a context (same pattern as
 * useFileNodeEditorRegistry) lets them read it directly instead.
 *
 * Default `true` so anything rendered outside a Canvas's provider (tests,
 * the reference-source preview's nested CanvasNodeView, etc.) behaves like
 * today — polling stays on rather than silently going stale.
 */
const WorkspaceActiveContext = createContext(true);

/**
 * Whether the enclosing canvas currently owns document-level keyboard input.
 * This is intentionally narrower than workspace visibility: an editable
 * Canvas can stay live beside Chat while its node-level window listeners yield
 * as soon as the user moves interaction outside the Canvas region.
 *
 * Default `true` preserves standalone node surfaces and existing tests that
 * render outside a Canvas root.
 */
const CanvasKeyboardActiveContext = createContext(true);

export const WorkspaceActiveProvider = WorkspaceActiveContext.Provider;
export const CanvasKeyboardActiveProvider = CanvasKeyboardActiveContext.Provider;

export const useWorkspaceActive = (): boolean => useContext(WorkspaceActiveContext);
export const useCanvasKeyboardActive = (): boolean => useContext(CanvasKeyboardActiveContext);
