import type { MainCanvasPlugin } from '../types';
import { DevtoolsMainPlugin } from './devtools';
import { WebviewPageControlPlugin } from './webview-page-control';

// Main-side halves of built-in Canvas plugins.
export const BUILT_IN_MAIN_PLUGINS: MainCanvasPlugin[] = [
  DevtoolsMainPlugin,
  WebviewPageControlPlugin,
];
