/// <reference types="vite/client" />
declare module '*.css';

// Build-time constant injected by electron.vite.config.ts. True in dev builds,
// false in production builds (overridable with PULSE_PERF_TOOLS=1). Gates the
// optional /perf debug panel so it is stripped from packaged apps.
declare const __PERF_TOOLS__: boolean;

declare module 'markdown-it-task-lists' {
  import type { PluginWithOptions } from 'markdown-it';
  interface TaskListsOptions {
    enabled?: boolean;
    label?: boolean;
    labelAfter?: boolean;
  }
  const plugin: PluginWithOptions<TaskListsOptions>;
  export default plugin;
}
