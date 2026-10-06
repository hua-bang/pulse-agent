import { useSyncExternalStore } from 'react';
import { globalMcpAppsStore, type GlobalMcpAppsSnapshot } from './globalMcpAppsStore';

export const useGlobalMcpApps = (): GlobalMcpAppsSnapshot => useSyncExternalStore(
  globalMcpAppsStore.subscribe,
  globalMcpAppsStore.getSnapshot,
);
