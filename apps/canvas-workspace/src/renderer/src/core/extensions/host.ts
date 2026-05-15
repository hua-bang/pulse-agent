import { useMemo } from 'react';
import type { CanvasExtension, CanvasNavigation } from './types';
import {
  DefaultCanvasRouteRegistry,
  DefaultChatContributionRegistry,
  DefaultSidebarContributionRegistry,
} from './registries';

export const createCanvasExtensionHost = (
  extensions: CanvasExtension[],
  navigation: CanvasNavigation,
) => {
  const routes = new DefaultCanvasRouteRegistry();
  const chat = new DefaultChatContributionRegistry();
  const sidebar = new DefaultSidebarContributionRegistry();

  for (const extension of extensions) {
    extension.activate({ routes, chat, sidebar, navigation });
  }

  return { routes, chat, sidebar };
};

export const useCanvasExtensionHost = (
  extensions: CanvasExtension[],
  navigation: CanvasNavigation,
) => useMemo(
  () => createCanvasExtensionHost(extensions, navigation),
  [extensions, navigation],
);
