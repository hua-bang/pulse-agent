import type {
  CanvasRouteContribution,
  CanvasRouteRegistry,
  ChatContributionRegistry,
  ChatMessageAddonContribution,
  SidebarContributionRegistry,
  SidebarNavContribution,
} from './types';

export class DefaultCanvasRouteRegistry implements CanvasRouteRegistry {
  private readonly routes: CanvasRouteContribution[] = [];

  register(contribution: CanvasRouteContribution): void {
    this.routes.push(contribution);
  }

  getByPath(path: string): CanvasRouteContribution | undefined {
    return this.routes.find(route => route.path === path);
  }

  getByView(view: string): CanvasRouteContribution | undefined {
    return this.routes.find(route => route.view === view);
  }

  list(): CanvasRouteContribution[] {
    return [...this.routes];
  }
}

export class DefaultChatContributionRegistry implements ChatContributionRegistry {
  private readonly messageAddons: ChatMessageAddonContribution[] = [];

  registerMessageAddon(contribution: ChatMessageAddonContribution): void {
    this.messageAddons.push(contribution);
  }

  listMessageAddons(): ChatMessageAddonContribution[] {
    return [...this.messageAddons];
  }
}

export class DefaultSidebarContributionRegistry implements SidebarContributionRegistry {
  private readonly navItems: SidebarNavContribution[] = [];

  registerNavItem(contribution: SidebarNavContribution): void {
    this.navItems.push(contribution);
  }

  listNavItems(): SidebarNavContribution[] {
    return [...this.navItems];
  }
}
