import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { DockStore, type DockState } from './dock-store';
import { createDockSessionPersistence } from './dock-session-persistence';

interface RightDockContextValue {
  store: DockStore;
  chatHost: HTMLDivElement | null;
  setChatHost: (el: HTMLDivElement | null) => void;
  terminalHost: HTMLDivElement | null;
  setTerminalHost: (el: HTMLDivElement | null) => void;
  pinUrlReference: (url: string, title?: string) => void;
  registerPinUrlReference: (handler: (url: string, title?: string) => void) => () => void;
}

const RightDockContext = createContext<RightDockContextValue | null>(null);

export const RightDockProvider = ({ children }: { children: ReactNode }) => {
  const store = useMemo(() => new DockStore(
    typeof window === 'undefined' ? undefined : createDockSessionPersistence(window.localStorage),
  ), []);
  const [chatHost, setChatHost] = useState<HTMLDivElement | null>(null);
  const [terminalHost, setTerminalHost] = useState<HTMLDivElement | null>(null);
  const pinUrlReferenceRef = useRef<((url: string, title?: string) => void) | null>(null);
  const pinUrlReference = useCallback((url: string, title?: string) => {
    pinUrlReferenceRef.current?.(url, title);
  }, []);
  const registerPinUrlReference = useCallback((handler: (url: string, title?: string) => void) => {
    pinUrlReferenceRef.current = handler;
    return () => {
      if (pinUrlReferenceRef.current === handler) pinUrlReferenceRef.current = null;
    };
  }, []);
  const value = useMemo<RightDockContextValue>(() => ({
    store,
    chatHost,
    setChatHost,
    terminalHost,
    setTerminalHost,
    pinUrlReference,
    registerPinUrlReference,
  }), [store, chatHost, terminalHost, pinUrlReference, registerPinUrlReference]);
  return <RightDockContext.Provider value={value}>{children}</RightDockContext.Provider>;
};

export const useDockContext = (): RightDockContextValue => {
  const ctx = useContext(RightDockContext);
  if (!ctx) throw new Error('useRightDock must be used within <RightDockProvider>');
  return ctx;
};

/** Dock actions — safe to call from anywhere under the provider. */
export function useRightDock(): {
  openArtifact: (workspaceId: string, artifactId: string) => void;
  openNodeDetail: (workspaceId: string, nodeId: string, title: string) => void;
  openCanvasPreview: (workspaceId: string, title: string) => boolean;
  openLink: (url: string) => void;
  newLink: () => void;
  openChat: () => void;
  toggleChat: () => void;
  openTerminal: () => void;
  newTerminal: () => void;
  toggleTerminal: () => void;
  closeTerminal: (id?: string) => void;
  setTerminalAgentType: (id: string, agentType?: string, workspaceId?: string) => void;
  setMountedWorkspaces: (ids: Iterable<string>) => void;
  collapse: () => void;
  notifyChatActivity: () => void;
  pinUrlReference: (url: string, title?: string) => void;
  registerPinUrlReference: (handler: (url: string, title?: string) => void) => () => void;
} {
  const { store, pinUrlReference, registerPinUrlReference } = useDockContext();
  return useMemo(() => ({
    openArtifact: (workspaceId: string, artifactId: string) => store.openArtifact(workspaceId, artifactId),
    openNodeDetail: (workspaceId: string, nodeId: string, title: string) => store.openNodeDetail(workspaceId, nodeId, title),
    openCanvasPreview: (workspaceId: string, title: string) => store.openCanvasPreview(workspaceId, title),
    openLink: (url: string) => store.openLink(url),
    newLink: () => store.newLink(),
    openChat: () => store.openChat(),
    toggleChat: () => store.toggleChat(),
    openTerminal: () => store.openTerminal(),
    newTerminal: () => store.newTerminal(),
    toggleTerminal: () => store.toggleTerminal(),
    closeTerminal: (id?: string) => store.closeTerminal(id),
    setTerminalAgentType: (id: string, agentType?: string, workspaceId?: string) =>
      store.setTerminalAgentType(id, agentType, workspaceId),
    setMountedWorkspaces: (ids: Iterable<string>) => store.setMountedWorkspaces(ids),
    collapse: () => store.collapse(),
    notifyChatActivity: () => store.notifyChatActivity(),
    pinUrlReference,
    registerPinUrlReference,
  }), [store, pinUrlReference, registerPinUrlReference]);
}

export const useRightDockState = (): DockState => {
  const { store } = useDockContext();
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
};

export const useRightDockChatHost = (): HTMLDivElement | null => useDockContext().chatHost;

export const useRightDockTerminalHost = (): HTMLDivElement | null => useDockContext().terminalHost;
