import { createContext, useContext, type ReactNode } from 'react';
import type { AgentScope } from '../../../types';

interface McpAppsContextValue {
  scope: AgentScope;
}

const McpAppsContext = createContext<McpAppsContextValue | null>(null);

export const McpAppsProvider = ({
  children,
  scope,
}: McpAppsContextValue & { children: ReactNode }) => (
  <McpAppsContext.Provider value={{ scope }}>
    {children}
  </McpAppsContext.Provider>
);

export const useMcpAppsHost = (): McpAppsContextValue | null => useContext(McpAppsContext);
