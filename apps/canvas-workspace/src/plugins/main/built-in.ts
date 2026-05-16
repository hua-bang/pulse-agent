import type { MainCanvasPlugin } from '../types';
import { DevtoolsMainPlugin } from './devtools';

// Main-side halves of built-in Canvas plugins.
export const BUILT_IN_MAIN_PLUGINS: MainCanvasPlugin[] = [DevtoolsMainPlugin];
