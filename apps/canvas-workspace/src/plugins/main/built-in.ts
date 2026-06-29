import type { MainCanvasPlugin } from '../types';
import { DynamicAppPlugin } from './dynamic-app';
import { DevtoolsMainPlugin } from './devtools';
import { WebviewPageControlPlugin } from './webview-page-control';
import { ChannelMainPlugin } from './channel';
import { MockNodeMainPlugin } from '../mock-node/main';
import { PerfMainPlugin } from './perf';

// Main-side halves of built-in Canvas plugins. PerfMainPlugin is gated on the
// build-time __PERF_TOOLS__ constant so production builds tree-shake it out.
export const BUILT_IN_MAIN_PLUGINS: MainCanvasPlugin[] = [
  DevtoolsMainPlugin,
  WebviewPageControlPlugin,
  DynamicAppPlugin,
  ChannelMainPlugin,
  MockNodeMainPlugin,
  ...(__PERF_TOOLS__ ? [PerfMainPlugin] : []),
];
