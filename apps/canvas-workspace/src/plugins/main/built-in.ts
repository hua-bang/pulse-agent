import { app } from 'electron';
import type { MainCanvasPlugin } from '../types';
import { MockNodeMainPlugin } from '../mock-node/main';
import { getExperimentalFlagSync } from '../../main/settings/experimental-ipc';
import {
  EXPERIMENTAL_FLAG_CHANNELS,
  EXPERIMENTAL_FLAG_DYNAMIC_APP,
  EXPERIMENTAL_FLAG_WEBVIEW_PAGE_CONTROL,
} from '../../shared/experimental-features';

const lazyPlugin = (
  id: string,
  enabledWhen: () => boolean,
  load: () => Promise<MainCanvasPlugin>,
): MainCanvasPlugin => {
  let loaded: MainCanvasPlugin | null = null;
  return {
    id,
    enabledWhen,
    async activate(ctx) {
      loaded = await load();
      await loaded.activate(ctx);
    },
    async deactivate() {
      await loaded?.deactivate?.();
      loaded = null;
    },
  };
};

const isAgentObservabilityEnabled = (): boolean => (
  !app.isPackaged
  && process.env.NODE_ENV === 'development'
  && process.env.PULSE_CANVAS_AGENT_OBSERVABILITY === '1'
);

const DevtoolsMainPlugin = lazyPlugin(
  'devtools',
  isAgentObservabilityEnabled,
  async () => (await import('./devtools')).DevtoolsMainPlugin,
);

const DynamicAppPlugin = lazyPlugin(
  'dynamic-app',
  () => getExperimentalFlagSync(EXPERIMENTAL_FLAG_DYNAMIC_APP),
  async () => (await import('./dynamic-app')).DynamicAppPlugin,
);
const WebviewPageControlPlugin = lazyPlugin(
  'webview-page-control',
  () => getExperimentalFlagSync(EXPERIMENTAL_FLAG_WEBVIEW_PAGE_CONTROL),
  async () => (await import('./webview-page-control')).WebviewPageControlPlugin,
);
const HostRendererControlPlugin = lazyPlugin(
  'host-renderer-control',
  () => true,
  async () => (await import('./host-renderer-control')).HostRendererControlPlugin,
);
const ChannelMainPlugin = lazyPlugin(
  'channel',
  () => getExperimentalFlagSync(EXPERIMENTAL_FLAG_CHANNELS)
    && Boolean(process.env.FEISHU_APP_ID?.trim() && process.env.FEISHU_APP_SECRET?.trim()),
  async () => (await import('./channel')).ChannelMainPlugin,
);
const LangfuseObservabilityMainPlugin = lazyPlugin(
  'langfuse-observability',
  () => isAgentObservabilityEnabled() && Boolean(
    process.env.LANGFUSE_PUBLIC_KEY?.trim()
      && process.env.LANGFUSE_SECRET_KEY?.trim(),
  ),
  async () => (await import('./langfuse-observability')).LangfuseObservabilityMainPlugin,
);

// Main-side halves of built-in Canvas plugins.
export const BUILT_IN_MAIN_PLUGINS: MainCanvasPlugin[] = [
  LangfuseObservabilityMainPlugin,
  DevtoolsMainPlugin,
  WebviewPageControlPlugin,
  HostRendererControlPlugin,
  DynamicAppPlugin,
  ChannelMainPlugin,
  MockNodeMainPlugin,
];
