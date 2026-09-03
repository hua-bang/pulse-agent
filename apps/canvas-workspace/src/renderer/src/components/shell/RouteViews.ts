import { createElement, lazy, Suspense, type ComponentProps } from 'react';

export { ScheduledRouteViews } from '../../modules/scheduled/surface';
export { SkillsRouteView } from '../../views/SkillsLibrary/SkillsRouteView';

const PluginMarketRouteViewInner = lazy(() => (
  import('../../views/PluginMarket').then((module) => ({ default: module.PluginMarketRouteView }))
));

export const PluginMarketRouteView = (
  props: ComponentProps<typeof PluginMarketRouteViewInner>,
) => createElement(
  Suspense,
  { fallback: null },
  createElement(PluginMarketRouteViewInner, props),
);
