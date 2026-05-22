/// <reference types="vite/client" />
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
