import {
  createContext,
  useContext,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import type { ChatDeliveryReceipt } from './chatTarget';
import type { DockState } from './dockTypes';
import type {
  AgentContextDomReviewComment,
  AgentContextDomSelectionRef,
  AgentContextTabRef,
  CanvasConfigScope,
  CanvasSkillEntry,
} from '../types';

export interface DockActions {
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
  submitDomReviewComments: (workspaceId: string, comments: AgentContextDomReviewComment[]) => Promise<boolean>;
  registerSubmitDomReviewComments: (handler: (workspaceId: string, comments: AgentContextDomReviewComment[]) => Promise<boolean>) => () => void;
  addTabToChat: (workspaceId: string, tab: AgentContextTabRef) => Promise<ChatDeliveryReceipt>;
  registerAddTabToChat: (handler: (workspaceId: string, tab: AgentContextTabRef) => Promise<ChatDeliveryReceipt>) => () => void;
  startSkillChat: (workspaceId: string, skillName: string) => void;
  registerStartSkillChat: (handler: (workspaceId: string, skillName: string) => void) => () => void;
}

interface DockStateStore {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => DockState;
}

interface DockPortValue {
  actions: DockActions;
  stateStore: DockStateStore;
  chatHost: HTMLDivElement | null;
  terminalHost: HTMLDivElement | null;
  mcpAppHosts: Readonly<Record<string, HTMLDivElement>>;
}

const DockPortContext = createContext<DockPortValue | null>(null);

export const DockPortProvider = ({ children, value }: { children: ReactNode; value: DockPortValue }) => (
  <DockPortContext.Provider value={value}>{children}</DockPortContext.Provider>
);

const useDockPort = (): DockPortValue => {
  const value = useContext(DockPortContext);
  if (!value) throw new Error('Dock port must be used within RightDockProvider');
  return value;
};

export const useRightDock = (): DockActions => useDockPort().actions;
export const useRightDockState = (): DockState => {
  const { stateStore } = useDockPort();
  return useSyncExternalStore(stateStore.subscribe, stateStore.getSnapshot);
};
export const useRightDockChatHost = (): HTMLDivElement | null => useDockPort().chatHost;
export const useRightDockTerminalHost = (): HTMLDivElement | null => useDockPort().terminalHost;
export const useRightDockMcpAppHost = (instanceId: string): HTMLDivElement | null => (
  useDockPort().mcpAppHosts[instanceId] ?? null
);
