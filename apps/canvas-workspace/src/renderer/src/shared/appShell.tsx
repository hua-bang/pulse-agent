import { createContext, useContext, type ReactNode } from 'react';
import type { ConfirmOptions, ToastInput, ToastRecord } from '../types/ui-interaction';

export interface AppShellPort {
  notify: (toast: ToastInput) => string;
  updateToast: (id: string, patch: Partial<Omit<ToastRecord, 'id' | 'createdAt'>>) => void;
  dismissToast: (id: string) => void;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  openShortcuts: () => void;
  closeShortcuts: () => void;
  shortcutsOpen: boolean;
  isOverlayOpen: boolean;
}

/**
 * Opens the Settings page from anywhere: the Cmd/Ctrl+, chord and the
 * canvas command palette. A window event, like the other shell requests, so
 * a module needs no handle on the router.
 */
export const OPEN_APP_SETTINGS_EVENT = 'pulse:open-app-settings';

export const requestOpenAppSettings = (): void => {
  window.dispatchEvent(new Event(OPEN_APP_SETTINGS_EVENT));
};

/**
 * Opens a plugin page by its registered route path, for example from the
 * plugin install card in chat. The app ignores paths that no plugin
 * registered.
 */
export const OPEN_PLUGIN_PAGE_EVENT = 'pulse:open-plugin-page';

export const requestOpenPluginPage = (path: string): void => {
  window.dispatchEvent(new CustomEvent<string>(OPEN_PLUGIN_PAGE_EVENT, { detail: path }));
};

const AppShellContext = createContext<AppShellPort | null>(null);

export const AppShellPortProvider = ({
  children,
  value,
}: {
  children: ReactNode;
  value: AppShellPort;
}) => <AppShellContext.Provider value={value}>{children}</AppShellContext.Provider>;

export const useAppShell = (): AppShellPort => {
  const context = useContext(AppShellContext);
  if (!context) throw new Error('useAppShell must be used within AppShellProvider');
  return context;
};
