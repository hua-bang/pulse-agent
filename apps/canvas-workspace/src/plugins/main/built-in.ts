import type { MainCanvasPlugin } from '../types';
import { DynamicAppPlugin } from './dynamic-app';
import { DevtoolsMainPlugin } from './devtools';
import { WebviewPageControlPlugin } from './webview-page-control';
import { ChannelMainPlugin } from './channel';

// Main-side halves of built-in Canvas plugins.
export const BUILT_IN_MAIN_PLUGINS: MainCanvasPlugin[] = [
  DevtoolsMainPlugin,
  WebviewPageControlPlugin,
  DynamicAppPlugin,
  ChannelMainPlugin,
];
