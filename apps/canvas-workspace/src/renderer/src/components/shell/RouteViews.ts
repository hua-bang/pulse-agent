import { createElement, lazy, Suspense, type ComponentProps } from 'react';

export { ScheduledRouteViews } from '../../modules/scheduled/surface';
export { SkillsRouteView } from '../../modules/skills/surface';

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
