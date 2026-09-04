import { createContext, useContext } from 'react';

// Background workspaces remain mounted for fast switching, so visibility and
// keyboard ownership are separate signals. Defaults preserve standalone
// surfaces and tests rendered outside a Canvas provider.
const WorkspaceActiveContext = createContext(true);
const CanvasKeyboardActiveContext = createContext(true);

export const WorkspaceActiveProvider = WorkspaceActiveContext.Provider;
export const CanvasKeyboardActiveProvider = CanvasKeyboardActiveContext.Provider;

export const useWorkspaceActive = (): boolean => useContext(WorkspaceActiveContext);
export const useCanvasKeyboardActive = (): boolean => useContext(CanvasKeyboardActiveContext);
