import type React from 'react';
import type { AgentChatMessage } from '../../types';

export interface CanvasNavigation {
  open(path: string): void;
}

export interface CanvasRouteContribution {
  id: string;
  path: string;
  view: string;
  render: (input: CanvasRouteRenderInput) => React.ReactNode;
  keepWorkbenchMounted?: boolean;
}

export interface CanvasRouteRenderInput {
  params: URLSearchParams;
  navigation: CanvasNavigation;
}

export interface ChatMessageAddonInput {
  message: AgentChatMessage;
}

export interface ChatMessageAddonContribution {
  id: string;
  shouldRender(input: ChatMessageAddonInput): boolean;
  render(input: ChatMessageAddonInput): React.ReactNode;
}

export interface SidebarNavContribution {
  id: string;
  view: string;
  label: string;
  title?: string;
  icon: React.ReactNode;
  onSelect(navigation: CanvasNavigation): void;
}

export interface CanvasRouteRegistry {
  register(contribution: CanvasRouteContribution): void;
  getByPath(path: string): CanvasRouteContribution | undefined;
  getByView(view: string): CanvasRouteContribution | undefined;
  list(): CanvasRouteContribution[];
}

export interface ChatContributionRegistry {
  registerMessageAddon(contribution: ChatMessageAddonContribution): void;
  listMessageAddons(): ChatMessageAddonContribution[];
}

export interface SidebarContributionRegistry {
  registerNavItem(contribution: SidebarNavContribution): void;
  listNavItems(): SidebarNavContribution[];
}

export interface CanvasExtensionContext {
  routes: CanvasRouteRegistry;
  chat: ChatContributionRegistry;
  sidebar: SidebarContributionRegistry;
  navigation: CanvasNavigation;
}

export interface CanvasExtension {
  id: string;
  name?: string;
  devOnly?: boolean;
  activate(ctx: CanvasExtensionContext): void;
}
