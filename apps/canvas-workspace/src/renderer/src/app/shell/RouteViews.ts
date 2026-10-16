import { createElement, Suspense, type ComponentProps } from 'react';
import { preloadableLazy, preloadWhenIdle } from '../../shared/preloadableLazy';
import { preloadChatSurfaces } from '../../modules/chat/lazy';
import { preloadLauncher } from './routes/HomeRouteView';
import { preloadScheduledPage } from './routes/ScheduledRouteViews';
import { preloadSettings } from './routes/SettingsRouteView';

export { ScheduledRouteViews } from './routes/ScheduledRouteViews';
export { SkillsRouteView } from './routes/SkillsRouteView';
export { NodesRouteViews } from './routes/NodesRouteViews';
export { SettingsRouteView } from './routes/SettingsRouteView';
export { HomeRouteView } from './routes/HomeRouteView';

const PluginMarketRouteViewInner = preloadableLazy(() => (
  import('../../modules/plugin-market').then((module) => ({ default: module.PluginMarketRouteView }))
));

export const PluginMarketRouteView = (
  props: ComponentProps<typeof PluginMarketRouteViewInner>,
) => createElement(
  Suspense,
  { fallback: null },
  createElement(PluginMarketRouteViewInner, props),
);

/** Fetches the main page chunks while the app is idle after startup. A page
 * switch then renders the page in its first frame, so the view transition
 * cross-fades into the page rather than into a blank fallback. */
export const preloadRoutePages = () => preloadWhenIdle([
  preloadLauncher,
  preloadChatSurfaces,
  preloadSettings,
  PluginMarketRouteViewInner.preload,
  preloadScheduledPage,
]);
