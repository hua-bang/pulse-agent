/// <reference types="vite/client" />
declare const __PULSE_CANVAS_AGENT_OBSERVABILITY__: boolean;
declare module '*.css';

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
