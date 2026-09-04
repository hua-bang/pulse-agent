import { createElement, lazy, Suspense, type ComponentProps } from 'react';

export { ScheduledRouteViews } from './routes/ScheduledRouteViews';
export { SkillsRouteView } from './routes/SkillsRouteView';
export { NodesRouteViews } from './routes/NodesRouteViews';

const PluginMarketRouteViewInner = lazy(() => (
  import('../../modules/plugin-market').then((module) => ({ default: module.PluginMarketRouteView }))
));

export const PluginMarketRouteView = (
  props: ComponentProps<typeof PluginMarketRouteViewInner>,
) => createElement(
  Suspense,
  { fallback: null },
  createElement(PluginMarketRouteViewInner, props),
);
