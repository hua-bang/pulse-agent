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
import type {
  AgentContextDomReviewComment,
  AgentContextDomSelectionRef,
  AgentContextTabRef,
} from '../../../types';
import type { CanvasConfigScope, CanvasSkillEntry } from '../../../types';
import { mcpAppTabId, skillTabId } from './dock-tab-ids';
import type { ChatDeliveryReceipt } from '../../chat/ChatTargetContext';

type SubmitDomReviewComments = (
  workspaceId: string,
  comments: AgentContextDomReviewComment[],
) => Promise<boolean>;

interface RightDockContextValue {
  store: DockStore;
  chatHost: HTMLDivElement | null;
  setChatHost: (el: HTMLDivElement | null) => void;
  terminalHost: HTMLDivElement | null;
  setTerminalHost: (el: HTMLDivElement | null) => void;
  mcpAppHosts: Readonly<Record<string, HTMLDivElement>>;
  setMcpAppHost: (instanceId: string, el: HTMLDivElement | null) => void;
  pinUrlReference: (url: string, title?: string) => void;
  registerPinUrlReference: (handler: (url: string, title?: string) => void) => () => void;
  addDomSelectionToChat: (workspaceId: string, selection: AgentContextDomSelectionRef) => Promise<ChatDeliveryReceipt>;
  registerAddDomSelectionToChat: (handler: (workspaceId: string, selection: AgentContextDomSelectionRef) => Promise<ChatDeliveryReceipt>) => () => void;
  submitDomReviewComments: SubmitDomReviewComments;
  registerSubmitDomReviewComments: (handler: SubmitDomReviewComments) => () => void;
  addTabToChat: (workspaceId: string, tab: AgentContextTabRef) => Promise<ChatDeliveryReceipt>;
  registerAddTabToChat: (handler: (workspaceId: string, tab: AgentContextTabRef) => Promise<ChatDeliveryReceipt>) => () => void;
  startSkillChat: (workspaceId: string, skillName: string) => void;
  registerStartSkillChat: (handler: (workspaceId: string, skillName: string) => void) => () => void;
}

const RightDockContext = createContext<RightDockContextValue | null>(null);

export const RightDockProvider = ({ children }: { children: ReactNode }) => {
  const store = useMemo(() => new DockStore(
    typeof window === 'undefined' ? undefined : createDockSessionPersistence(window.localStorage),
  ), []);
  const [chatHost, setChatHost] = useState<HTMLDivElement | null>(null);
  const [terminalHost, setTerminalHost] = useState<HTMLDivElement | null>(null);
  const [mcpAppHosts, setMcpAppHosts] = useState<Record<string, HTMLDivElement>>({});
  const setMcpAppHost = useCallback((instanceId: string, el: HTMLDivElement | null) => {
    setMcpAppHosts(current => {
      if (el && current[instanceId] === el) return current;
      if (!el && !current[instanceId]) return current;
      const next = { ...current };
      if (el) next[instanceId] = el;
      else delete next[instanceId];
      return next;
    });
  }, []);
  const pinUrlReferenceRef = useRef<((url: string, title?: string) => void) | null>(null);
  const addDomSelectionToChatRef = useRef<((workspaceId: string, selection: AgentContextDomSelectionRef) => Promise<ChatDeliveryReceipt>) | null>(null);
  const submitDomReviewCommentsRef = useRef<SubmitDomReviewComments | null>(null);
  const addTabToChatRef = useRef<((workspaceId: string, tab: AgentContextTabRef) => Promise<ChatDeliveryReceipt>) | null>(null);
  const startSkillChatRef = useRef<((workspaceId: string, skillName: string) => void) | null>(null);
  const pinUrlReference = useCallback((url: string, title?: string) => {
    pinUrlReferenceRef.current?.(url, title);
  }, []);
  const registerPinUrlReference = useCallback((handler: (url: string, title?: string) => void) => {
    pinUrlReferenceRef.current = handler;
    return () => {
      if (pinUrlReferenceRef.current === handler) pinUrlReferenceRef.current = null;
    };
  }, []);
  const addDomSelectionToChat = useCallback(async (workspaceId: string, selection: AgentContextDomSelectionRef) => {
    return await addDomSelectionToChatRef.current?.(workspaceId, selection)
      ?? { status: 'unavailable', target: null };
  }, []);
  const registerAddDomSelectionToChat = useCallback((handler: (workspaceId: string, selection: AgentContextDomSelectionRef) => Promise<ChatDeliveryReceipt>) => {
    addDomSelectionToChatRef.current = handler;
    return () => {
      if (addDomSelectionToChatRef.current === handler) addDomSelectionToChatRef.current = null;
    };
  }, []);
  const submitDomReviewComments = useCallback(async (
    workspaceId: string,
    comments: AgentContextDomReviewComment[],
  ) => await submitDomReviewCommentsRef.current?.(workspaceId, comments) ?? false, []);
  const registerSubmitDomReviewComments = useCallback((handler: SubmitDomReviewComments) => {
    submitDomReviewCommentsRef.current = handler;
    return () => {
      if (submitDomReviewCommentsRef.current === handler) submitDomReviewCommentsRef.current = null;
    };
  }, []);
  const addTabToChat = useCallback(async (workspaceId: string, tab: AgentContextTabRef) => {
    return await addTabToChatRef.current?.(workspaceId, tab)
      ?? { status: 'unavailable', target: null };
  }, []);
  const registerAddTabToChat = useCallback((handler: (workspaceId: string, tab: AgentContextTabRef) => Promise<ChatDeliveryReceipt>) => {
    addTabToChatRef.current = handler;
    return () => {
      if (addTabToChatRef.current === handler) addTabToChatRef.current = null;
    };
  }, []);
  const startSkillChat = useCallback((workspaceId: string, skillName: string) => {
    startSkillChatRef.current?.(workspaceId, skillName);
  }, []);
  const registerStartSkillChat = useCallback((handler: (workspaceId: string, skillName: string) => void) => {
    startSkillChatRef.current = handler;
    return () => {
      if (startSkillChatRef.current === handler) startSkillChatRef.current = null;
    };
  }, []);
  const value = useMemo<RightDockContextValue>(() => ({
    store,
    chatHost,
    setChatHost,
    terminalHost,
    setTerminalHost,
    mcpAppHosts,
    setMcpAppHost,
    pinUrlReference,
    registerPinUrlReference,
    addDomSelectionToChat,
    registerAddDomSelectionToChat,
    submitDomReviewComments,
    registerSubmitDomReviewComments,
    addTabToChat,
    registerAddTabToChat,
    startSkillChat,
    registerStartSkillChat,
  }), [store, chatHost, terminalHost, mcpAppHosts, setMcpAppHost, pinUrlReference, registerPinUrlReference, addDomSelectionToChat, registerAddDomSelectionToChat, submitDomReviewComments, registerSubmitDomReviewComments, addTabToChat, registerAddTabToChat, startSkillChat, registerStartSkillChat]);
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
  openMcpApp: (instanceId: string, title: string) => void;
  activateMcpApp: (instanceId: string) => void;
  closeMcpApp: (instanceId: string) => void;
  openNodeDetail: (workspaceId: string, nodeId: string, title: string) => void;
  enterNodePage: (workspaceId: string, nodeId: string) => void;
  openSkill: (scope: CanvasConfigScope, skill: CanvasSkillEntry) => void;
  closeSkill: (scope: CanvasConfigScope, skillName: string) => void;
  openCanvasPreview: (workspaceId: string, title: string) => boolean;
  openLink: (url: string) => void;
  newLink: () => void;
  openChat: () => void;
  openScheduledChat: (taskId: string) => void;
  refreshScheduledChat: (taskId: string) => void;
  toggleChat: () => void;
  toggleContentTabs: () => void;
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
  addDomSelectionToChat: (workspaceId: string, selection: AgentContextDomSelectionRef) => Promise<ChatDeliveryReceipt>;
  registerAddDomSelectionToChat: (handler: (workspaceId: string, selection: AgentContextDomSelectionRef) => Promise<ChatDeliveryReceipt>) => () => void;
  submitDomReviewComments: SubmitDomReviewComments;
  registerSubmitDomReviewComments: (handler: SubmitDomReviewComments) => () => void;
  addTabToChat: (workspaceId: string, tab: AgentContextTabRef) => Promise<ChatDeliveryReceipt>;
  registerAddTabToChat: (handler: (workspaceId: string, tab: AgentContextTabRef) => Promise<ChatDeliveryReceipt>) => () => void;
  startSkillChat: (workspaceId: string, skillName: string) => void;
  registerStartSkillChat: (handler: (workspaceId: string, skillName: string) => void) => () => void;
} {
  const {
    store,
    pinUrlReference,
    registerPinUrlReference,
    addDomSelectionToChat,
    registerAddDomSelectionToChat,
    submitDomReviewComments,
    registerSubmitDomReviewComments,
    addTabToChat,
    registerAddTabToChat,
    startSkillChat,
    registerStartSkillChat,
  } = useDockContext();
  return useMemo(() => ({
    openArtifact: (workspaceId: string, artifactId: string) => store.openArtifact(workspaceId, artifactId),
    openMcpApp: (instanceId: string, title: string) => store.openMcpApp(instanceId, title),
    activateMcpApp: (instanceId: string) => { store.activate(mcpAppTabId(instanceId)); },
    closeMcpApp: (instanceId: string) => store.closeMcpApp(instanceId),
    openNodeDetail: (workspaceId: string, nodeId: string, title: string) => store.openNodeDetail(workspaceId, nodeId, title),
    enterNodePage: (workspaceId: string, nodeId: string) => store.enterNodePage(workspaceId, nodeId),
    openSkill: (scope: CanvasConfigScope, skill: CanvasSkillEntry) => store.openSkill(scope, skill),
    closeSkill: (scope: CanvasConfigScope, skillName: string) => store.close(skillTabId(
      scope.level === 'workspace' ? scope.workspaceId : 'global',
      skillName,
    )),
    openCanvasPreview: (workspaceId: string, title: string) => store.openCanvasPreview(workspaceId, title),
    openLink: (url: string) => store.openLink(url),
    newLink: () => store.newLink(),
    openChat: () => store.openChat(),
    openScheduledChat: (taskId: string) => store.openScheduledChat(taskId),
    refreshScheduledChat: (taskId: string) => store.refreshScheduledChat(taskId),
    toggleChat: () => store.toggleChat(),
    toggleContentTabs: () => store.toggleContentTabs(),
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
    addDomSelectionToChat,
    registerAddDomSelectionToChat,
    submitDomReviewComments,
    registerSubmitDomReviewComments,
    addTabToChat,
    registerAddTabToChat,
    startSkillChat,
    registerStartSkillChat,
  }), [store, pinUrlReference, registerPinUrlReference, addDomSelectionToChat, registerAddDomSelectionToChat, submitDomReviewComments, registerSubmitDomReviewComments, addTabToChat, registerAddTabToChat, startSkillChat, registerStartSkillChat]);
}

export const useRightDockState = (): DockState => {
  const { store } = useDockContext();
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
};

export const useRightDockChatHost = (): HTMLDivElement | null => useDockContext().chatHost;

export const useRightDockTerminalHost = (): HTMLDivElement | null => useDockContext().terminalHost;

export const useRightDockMcpAppHost = (instanceId: string): HTMLDivElement | null => (
  useDockContext().mcpAppHosts[instanceId] ?? null
);
